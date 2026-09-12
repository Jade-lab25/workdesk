// Supabase Edge Function: llm-proxy
// 用途：浏览器直连被 CORS 拦截的 LLM API（如火山方舟 Agent Plan）时，
//       由 Supabase 服务端代发请求，绕过浏览器跨域限制。
// 调用方式：POST /functions/v1/llm-proxy
//   请求体：{ endpoint: string, apiKey: string, body: object }
// 返回：  透传上游 LLM API 的响应（status + body）
// 部署：Supabase Dashboard → Edge Functions → Create → 名称填 llm-proxy → 粘贴本代码 → Deploy
//
// 安全：endpoint 必须命中白名单（防 SSRF / 开放代理被人白嫖）。
//       anon key 是公开值（前端内置），所以本函数等于"任何人可调"，
//       绝不能接受任意 URL，只允许转发到火山方舟官方域名。

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 白名单：只允许转发到这些 LLM 服务商（要加新服务商时在这里追加 host + 路径前缀）
const ALLOW_LIST = [
  { host: 'ark.cn-beijing.volces.com', pathPrefix: '/api/plan/v3/' },
];

function checkAllowed(rawUrl: string): URL | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  const hit = ALLOW_LIST.find(
    (a) => a.host === u.hostname.toLowerCase() && u.pathname.startsWith(a.pathPrefix)
  );
  return hit ? u : null;
}

Deno.serve(async (req) => {
  // CORS 预检
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: '仅支持 POST' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { endpoint, apiKey, body } = await req.json();

    if (!endpoint || !apiKey || !body) {
      return new Response(
        JSON.stringify({ error: '缺少参数：需要 endpoint / apiKey / body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const target = checkAllowed(endpoint);
    if (!target) {
      return new Response(
        JSON.stringify({ error: 'endpoint 不在允许的服务商白名单内' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const upstream = await fetch(target.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify(body),
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String((e && e.message) || e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
