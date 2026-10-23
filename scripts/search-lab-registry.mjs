import { createHmac, timingSafeEqual } from "node:crypto";

const REPO = "mok9900/host";
const PATH = "runtime/search-registry.json";
const MAX_SESSION_MS = 350 * 60 * 1000;
const API = "https://api.github.com/repos/"+REPO+"/contents/"+PATH;

export function validQuickTunnel(endpoint) {
  if (typeof endpoint !== "string") return false;
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" &&
      /^[a-z0-9-]+\.trycloudflare\.com$/i.test(url.hostname) &&
      url.pathname === "/" && url.search === "" && url.hash === "" &&
      !url.username && !url.password && url.port === "";
  } catch { return false; }
}
function message(item) {
  return [item.version,item.status,item.endpoint,item.runId,item.startedAt,item.validUntil].join("|");
}
export function signRegistry(item, token) {
  return createHmac("sha256",token).update(message(item)).digest("hex");
}
export function makeRegistry({ endpoint, runId, token, now=Date.now(), status="online" }) {
  if (status !== "offline" && !validQuickTunnel(endpoint))
    throw new Error("Tunnel URL is not an HTTPS *.trycloudflare.com endpoint.");
  if (!/^[0-9]{1,24}$/.test(String(runId))) throw new Error("Invalid GitHub run id.");
  const record={
    version:1,status,endpoint:status==="offline"?"":endpoint,
    runId:String(runId),startedAt:now,validUntil:status==="online"?now+MAX_SESSION_MS:now,
  };
  return {...record,signature:signRegistry(record,token)};
}
export function verifyRegistry(data, token, now=Date.now()) {
  if (!data || data.version!==1 || data.status!=="online" ||
      !validQuickTunnel(data.endpoint) || !/^[0-9]{1,24}$/.test(data.runId) ||
      !Number.isSafeInteger(data.startedAt) || !Number.isSafeInteger(data.validUntil) ||
      data.startedAt>now+60_000 || now>data.validUntil ||
      data.validUntil-data.startedAt>MAX_SESSION_MS+60_000 ||
      typeof data.signature!=="string" || !/^[a-f0-9]{64}$/.test(data.signature))
    return false;
  const a=Buffer.from(data.signature,"hex"), b=Buffer.from(signRegistry(data,token),"hex");
  return timingSafeEqual(a,b);
}
async function apiFetch(method, payload) {
  const token=process.env.GH_TOKEN;
  if(!token) throw new Error("GITHUB_TOKEN missing");
  const response=await fetch(API,{
    method,
    headers:{
      "Authorization":"Bearer "+token,
      "Accept":"application/vnd.github+json",
      "X-GitHub-Api-Version":"2022-11-28",
      "Content-Type":"application/json",
      "User-Agent":"aster-search-lab-registry",
    },
    ...(payload ? {body:JSON.stringify(payload)}:{}),
    signal:AbortSignal.timeout(12000),
  });
  if(response.status===404 && method==="GET")return null;
  if(!response.ok)throw new Error("GitHub registry "+method+" failed: HTTP "+response.status);
  return response.json();
}
async function publish(status, endpoint, runId) {
  const secret=process.env.ASTER_TOOL_TOKEN;
  if(!secret || secret.length<32)throw new Error("Search token not derived");
  const old=await apiFetch("GET");
  if(status==="offline" && old) {
    const current=JSON.parse(Buffer.from(old.content.replace(/\s/g,""),"base64").toString());
    if(current.runId!==String(runId)) {
      process.stdout.write("Registry belongs to a different search run; not clearing.\n");
      return;
    }
  }
  const record=makeRegistry({status,endpoint,runId,token:secret});
  const body={
    message:"runtime(search): "+(status==="online"?"register":"unregister")+" short-lived search lab "+runId,
    content:Buffer.from(JSON.stringify(record,null,2)+"\n").toString("base64"),
    ...(old ? {sha:old.sha}:{}),
  };
  await apiFetch("PUT",body);
  process.stdout.write("Search registry is "+status+" (run "+runId+").\n");
}
if (process.argv[1] && import.meta.url.endsWith("/"+process.argv[1].split("/").at(-1))) {
  const [status,endpoint]=process.argv.slice(2);
  if(!["online","offline"].includes(status))throw new Error("Expected online/offline");
  await publish(status,endpoint||"",process.env.GITHUB_RUN_ID);
}
