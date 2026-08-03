export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 1. 处理 OPTIONS 预检请求
    if (request.method === "OPTIONS") {
      return handleCORS();
    }

    // 2. 优先获取代理目标 URL
    let targetUrl = url.searchParams.get("url");

    // 支持路径代理形式：/https://example.com
    if (!targetUrl) {
      const candidate = pathname.startsWith("/") ? pathname.slice(1) : pathname;

      if (candidate.startsWith("http")) {
        targetUrl = decodeURIComponent(candidate) + url.search;
      }
    }

    // 3. 非代理请求才走静态资源
    const isStaticAsset =
      !targetUrl &&
      (
        pathname === "/" ||
        pathname === "/index.html" ||
        pathname === "/logo.ico" ||
        pathname === "/logo.gif" ||
        pathname === "/logo.png" ||
        pathname === "/_headers" ||
        pathname === "/wrangler.toml" ||
        pathname === "/wrangler.json"
      );

    if (isStaticAsset) {
      return env.ASSETS.fetch(request);
    }

    // 4. 没有代理目标时，交给静态资源
    if (!targetUrl) {
      return env.ASSETS.fetch(request);
    }

    try {
      const decodedUrl = targetUrl.startsWith("http")
        ? targetUrl
        : decodeURIComponent(targetUrl);

      const proxyRequestInit = {
        method: request.method,
        headers: {},
        redirect: "follow",
      };

      const excludeHeaders = [
        "host",
        "origin",
        "referer",
        "cookie",
        "cf-connecting-ip",
        "cf-ipcountry",
        "cf-ray",
        "cf-visitor",
        "x-forwarded-for",
        "x-forwarded-proto",
      ];

      for (const [key, value] of request.headers) {
        const lowerKey = key.toLowerCase();

        if (!excludeHeaders.includes(lowerKey)) {
          proxyRequestInit.headers[key] = value;
        }
      }

      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
        proxyRequestInit.body = await request.arrayBuffer();
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const response = await fetch(decodedUrl, {
          ...proxyRequestInit,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const responseHeaders = new Headers(response.headers);
        const corsHeaders = getCORSHeaders();

        for (const [key, value] of Object.entries(corsHeaders)) {
          responseHeaders.set(key, value);
        }

        responseHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate");
        responseHeaders.set("Pragma", "no-cache");
        responseHeaders.set("Expires", "0");

        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        });
      } catch (fetchError) {
        clearTimeout(timeoutId);

        if (fetchError.name === "AbortError") {
          return new Response("代理请求超时", {
            status: 504,
            headers: getCORSHeaders(),
          });
        }

        throw fetchError;
      }
    } catch (error) {
      return new Response(`代理请求失败: ${error.message}`, {
        status: 500,
        headers: getCORSHeaders(),
      });
    }
  },
};

function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: getCORSHeaders(),
  });
}

function getCORSHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Expose-Headers": "*",
  };
}
