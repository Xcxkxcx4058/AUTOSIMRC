
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({
        status: "ok",
        app: "AUTOSIMRC",
        database: Boolean(env.DB)
      });
    }

    if (url.pathname === "/api/vehicles" && request.method === "GET") {
      try {
        const result = await env.DB.prepare(
          "SELECT * FROM vehicles ORDER BY make, model, year"
        ).all();

        return Response.json({
          success: true,
          count: result.results.length,
          vehicles: result.results
        });
      } catch (error) {
        return Response.json({
          success: false,
          error: "Could not load vehicles"
        }, { status: 500 });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
