
function csvToRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift().map(h => h.trim());
  return rows
    .filter(r => r.some(v => v.trim() !== ""))
    .map(r => Object.fromEntries(
      headers.map((h, i) => [h, (r[i] || "").trim()])
    ));
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function makeRecordKey(v) {
  return [
    v.make, v.model, v.variant,
    v.yearFrom, v.yearTo
  ].map(x => String(x || "").trim().toLowerCase()).join("|");
}

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
if (url.pathname === "/api/makes" && request.method === "GET") {
  const result = await env.DB.prepare(
    "SELECT DISTINCT make FROM vehicles ORDER BY make"
  ).all();

  return Response.json({
    success: true,
    makes: result.results.map(row => row.make)
  });
}

if (url.pathname === "/api/models" && request.method === "GET") {
  const make = url.searchParams.get("make");

  if (!make) {
    return Response.json({
      success: false,
      error: "Make is required"
    }, { status: 400 });
  }

  const result = await env.DB.prepare(
    "SELECT DISTINCT model FROM vehicles WHERE make = ? ORDER BY model"
  ).bind(make.toUpperCase()).all();

  return Response.json({
    success: true,
    make: make.toUpperCase(),
    models: result.results.map(row => row.model)
  });
}
    if (url.pathname === "/api/variants" && request.method === "GET") {
  const make = url.searchParams.get("make");
  const model = url.searchParams.get("model");

  if (!make || !model) {
    return Response.json({
      success: false,
      error: "Make and model are required"
    }, { status: 400 });
  }

  const result = await env.DB.prepare(`
    SELECT id, make, model, variant, year_from, year_to,
           engine_displacement_cc, power_hp, torque_nm,
           fuel_type, transmission, drivetrain,
           weight_kg, fuel_consumption_l_100km,
           top_speed_kmh, acceleration_0_100_s,
           specifications_json
    FROM vehicles
    WHERE make = ? AND model = ?
    ORDER BY year_from, variant
  `).bind(make.toUpperCase(), model).all();

  return Response.json({
    success: true,
    count: result.results.length,
    variants: result.results
  });
}
    if (url.pathname === "/api/vehicles" && request.method === "GET") {
      const result = await env.DB.prepare(
        "SELECT * FROM vehicles ORDER BY make, model, year"
      ).all();

      return Response.json({
        success: true,
        count: result.results.length,
        vehicles: result.results
      });
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

      try {
        const response = await fetch(searchUrl);
        const data = await response.json();

        return Response.json({
          success: response.ok,
          source: "CarsDataset free preview",
          data
        }, { status: response.ok ? 200 : 502 });
      } catch {
        return Response.json({
          success: false,
          error: "External database unavailable"
        }, { status: 502 });
      }
    }

    if (url.pathname === "/api/admin/import" && request.method === "POST") {
      const adminKey = request.headers.get("X-Admin-Key");

      if (!env.AUTOSIMRC_ADMIN_KEY ||
          adminKey !== env.AUTOSIMRC_ADMIN_KEY) {
        return Response.json({
          success: false,
          error: "Unauthorized"
        }, { status: 401 });
      }

      try {
        const form = await request.formData();
        const file = form.get("file");
        const sourceUrl = form.get("source_url") ||
          "https://cardata.wiki/";
        const license = "CC BY 4.0";

        if (!file || typeof file.text !== "function") {
          return Response.json({
            success: false,
            error: "CSV file is required"
          }, { status: 400 });
        }

        if (file.size > 8 * 1024 * 1024) {
          return Response.json({
            success: false,
            error: "Maximum CSV size is 8 MB"
          }, { status: 413 });
        }

        const text = (await file.text()).replace(/^\uFEFF/, "");
        const records = csvToRows(text);

        if (!records.length ||
            !records[0].make ||
            !records[0].model ||
            !records[0].variant) {
          return Response.json({
            success: false,
            error: "CSV must contain make, model and variant columns"
          }, { status: 400 });
        }

        const make = records[0].make.toUpperCase();

        if (records.some(r => r.make.toUpperCase() !== make)) {
          return Response.json({
            success: false,
            error: "Upload one vehicle make per file"
          }, { status: 400 });
        }

        if (records.length > 5000) {
          return Response.json({
            success: false,
            error: "Maximum 5000 vehicle variants per import"
          }, { status: 400 });
        }

        const batchId = crypto.randomUUID();

        await env.DB.prepare(
          `INSERT INTO vehicle_imports
           (make, source_name, source_url, source_license, status)
           VALUES (?, ?, ?, ?, 'processing')`
        ).bind(
          make, "Cardata.wiki CSV", sourceUrl, license
        ).run();

        const importId = await env.DB.prepare(
          "SELECT last_insert_rowid() AS id"
        ).first();

        const statements = records.map(v => {
          const yearFrom = numberOrNull(v.yearFrom);
          const yearTo = numberOrNull(v.yearTo);
          const key = makeRecordKey(v);

          return env.DB.prepare(`
            INSERT INTO vehicles (
              make, model, year, trim, engine,
              fuel_type, engine_displacement_cc, power_hp,
              torque_nm, transmission, drivetrain, weight_kg,
              fuel_tank_l, fuel_consumption_l_100km,
              top_speed_kmh, acceleration_0_100_s,
              data_source, variant, year_from, year_to,
              body_type, engine_code, specifications_json,
              source_url, source_license, import_batch_id,
              source_record_key, updated_at
            ) VALUES (
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              CURRENT_TIMESTAMP
            )
            ON CONFLICT(source_record_key) DO UPDATE SET
              model = excluded.model,
              year = excluded.year,
              trim = excluded.trim,
              engine = excluded.engine,
              fuel_type = excluded.fuel_type,
              engine_displacement_cc = excluded.engine_displacement_cc,
              power_hp = excluded.power_hp,
              torque_nm = excluded.torque_nm,
              transmission = excluded.transmission,
              drivetrain = excluded.drivetrain,
              weight_kg = excluded.weight_kg,
              fuel_tank_l = excluded.fuel_tank_l,
              fuel_consumption_l_100km = excluded.fuel_consumption_l_100km,
              top_speed_kmh = excluded.top_speed_kmh,
              acceleration_0_100_s = excluded.acceleration_0_100_s,
              variant = excluded.variant,
              year_from = excluded.year_from,
              year_to = excluded.year_to,
              body_type = excluded.body_type,
              engine_code = excluded.engine_code,
              specifications_json = excluded.specifications_json,
              source_url = excluded.source_url,
              source_license = excluded.source_license,
              import_batch_id = excluded.import_batch_id,
              updated_at = CURRENT_TIMESTAMP
          `).bind(
            make,
            v.model,
            yearFrom,
            v.variant,
            v.engineCode || null,
            v.engineFuelType || null,
            numberOrNull(v.engineDisplacement),
            numberOrNull(v.enginePowerBhp),
            numberOrNull(v.engineTorqueNm),
            v.gearboxType || null,
            v.drivetrain || null,
            numberOrNull(v.weightKg),
            numberOrNull(v.fuelTankLitres),
            numberOrNull(v.fuelEconomyCombinedL100),
            numberOrNull(v.topSpeedKph),
            numberOrNull(v.acceleration0100),
            "Cardata.wiki",
            v.variant,
            yearFrom,
            yearTo,
            v.bodyType || null,
            v.engineCode || null,
            JSON.stringify(v),
            sourceUrl,
            license,
            batchId,
            key
          );
        });

        let imported = 0;

        for (let i = 0; i < statements.length; i += 50) {
          const chunk = statements.slice(i, i + 50);
          await env.DB.batch(chunk);
          imported += chunk.length;
        }

        await env.DB.prepare(`
          UPDATE vehicle_imports
          SET imported_count = ?,
              status = 'completed'
          WHERE id = ?
        `).bind(imported, importId.id).run();

        return Response.json({
          success: true,
          make,
          imported,
          batch_id: batchId,
          source: "Cardata.wiki",
          license
        });
      } catch (error) {
        return Response.json({
          success: false,
          error: "Import failed",
          details: String(error.message || error)
        }, { status: 500 });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
