
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

    if (url.pathname === "/api/search" && request.method === "GET") {
      const brand = url.searchParams.get("brand");
      const model = url.searchParams.get("model");
      const year = url.searchParams.get("year");

      if (!brand && !model) {
        return Response.json({
          success: false,
          error: "Enter a brand or model"
        }, { status: 400 });
      }

      const searchUrl = new URL(
        "https://api.carsdataset.com/api/v1/preview/search"
      );

      if (brand) searchUrl.searchParams.set("brand", brand);
      if (model) searchUrl.searchParams.set("model", model);

      if (year && /^\d{4}$/.test(year)) {
        searchUrl.searchParams.set("year_min", year);
        searchUrl.searchParams.set("year_max", year);
      }

      searchUrl.searchParams.set("page_size", "100");

      try {
        const response = await fetch(searchUrl);
        const data = await response.json();

        return Response.json({
          success: response.ok,
          source: "CarsDataset free preview",
          data
        }, { status: response.ok ? 200 : 502 });
      } catch (error) {
        return Response.json({
          success: false,
          error: "External vehicle database is unavailable"
        }, { status: 502 });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
