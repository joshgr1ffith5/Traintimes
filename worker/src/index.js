
const DARWIN_URL =
  "https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120/GetDepartureBoard/CIT";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== "/departures") {
      return new Response("Not found", { status: 404 });
    }

    if (!env.DARWIN_API_KEY) {
      return Response.json(
        { error: "API key not configured" },
        { status: 503 }
      );
    }

    try {
      const response = await fetch(DARWIN_URL, {
        headers: {
          "x-apikey": env.DARWIN_API_KEY,
          "Accept": "application/json"
        },
        cf: {
          cacheTtl: 30,
          cacheEverything: true
        }
      });

      if (!response.ok) {
        return Response.json(
          {
            error: "National Rail request failed",
            status: response.status
          },
          { status: 502 }
        );
      }

      const data = await response.json();

      return Response.json(data, {
        headers: {
          "Cache-Control": "public, max-age=30",
          "Access-Control-Allow-Origin": "*"
        }
      });
    } catch (error) {
      return Response.json(
        { error: "Unable to retrieve departures" },
        { status: 502 }
      );
    }
  }
};
