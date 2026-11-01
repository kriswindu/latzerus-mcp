import worker from "./worker.js";
for (const [m,p] of [["GET","/"],["GET","/mcp"],["OPTIONS","/mcp"],["GET","/x"],["GET","/.well-known/mcp/server.json"]]) {
  const r = await worker.fetch(new Request("https://mcp.latzerus.ch"+p,{method:m}));
  const need=["strict-transport-security","content-security-policy","x-frame-options","x-content-type-options","referrer-policy","permissions-policy","access-control-allow-origin"];
  console.log(m,p,r.status, need.map(k=>r.headers.has(k)?"+":"-").join(""));
}
