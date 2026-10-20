
const DARWIN_URL =
  "https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120/GetDepBoardWithDetails/CIT";

const DISRUPTIONS_URL =
  "https://api1.raildata.org.uk/1010-disruptions-experience-api-11_1/stations/disruptions/incidents?crsCode=CIT";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    let apiUrl;
    let apiKey;
    let cacheSeconds;

    if (url.pathname === "/departures") {
      apiUrl = DARWIN_URL;
      apiKey = env.DARWIN_API_KEY;
      cacheSeconds = 30;
    } else if (url.pathname === "/engineering") {
      apiUrl = DISRUPTIONS_URL;
      apiKey = env.DISRUPTIONS_API_KEY || env.DARWIN_API_KEY;
      cacheSeconds = 300;
    } else {
      return new Response("Not found", {
        status: 404,
        headers: corsHeaders
      });
    }

    if (!apiKey) {
      return Response.json(
        { error: "API key not configured" },
        {
          status: 503,
          headers: corsHeaders
        }
      );
    }

    try {
      const response = await fetch(apiUrl, {
        headers: {
          "x-apikey": apiKey,
          "Accept": "application/json"
        },
        cf: {
          cacheTtl: cacheSeconds,
          cacheEverything: true
        }
      });

      if (!response.ok) {
        return Response.json(
          {
            error: "National Rail request failed",
            status: response.status
          },
          {
            status: 502,
            headers: corsHeaders
          }
        );
      }

      const data = await response.json();

      return Response.json(data, {
        headers: {
          ...corsHeaders,
          "Cache-Control": `public, max-age=${cacheSeconds}`
        }
      });
    } catch (error) {
      return Response.json(
        { error: "Unable to retrieve National Rail data" },
        {
          status: 502,
          headers: corsHeaders
        }
      );
    }
  }
};
