
const DARWIN_URL =
  'https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120/GetDepBoardWithDetails/CIT';

const INCIDENTS_URL =
  'https://api1.raildata.org.uk/1010-disruptions-experience-api-11_1/stations/disruptions/incidents';

const STATIONS = [
  { crs: 'CIT', name: 'Chislehurst' },
  { crs: 'EWD', name: 'Elmstead Woods' },
  { crs: 'GRP', name: 'Grove Park' },
  { crs: 'ORP', name: 'Orpington' },
  { crs: 'HGR', name: 'Hither Green' },
  { crs: 'LBG', name: 'London Bridge' }
];

const CORS = { 'Access-Control-Allow-Origin': '*' };

function json(data, status = 200, maxAge = 0) {
  return Response.json(data, {
    status,
    headers: {
      ...CORS,
      'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store'
    }
  });
}

async function getNationalRail(url, apiKey, seconds) {
  const response = await fetch(url, {
    headers: {
      'x-apikey': apiKey,
      Accept: 'application/json'
    },
    cf: {
      cacheTtl: seconds,
      cacheEverything: true
    }
  });

  if (!response.ok) {
    throw new Error(`National Rail HTTP ${response.status}`);
  }

  return response.json();
}

// Read the disruption notices for one station.
function findStationDisruptions(data, crs) {
  const entries = Array.isArray(data) ? data : [data];

  return entries
    .filter(entry => entry && typeof entry === 'object')
    .filter(entry => !entry.crsCode || entry.crsCode === crs)
    .flatMap(entry =>
      Array.isArray(entry.disruptions) ? entry.disruptions : []
    );
}

// Find a unique identifier for each incident.
function identifier(item) {
  if (!item || typeof item !== 'object') return null;

  return item.incidentNumber ?? item.incidentId ?? item.id ?? null;
}

// Separate planned engineering works from other incidents.
function plannedStatus(item) {
  if (!item || typeof item !== 'object') return null;

  const value = item.planned ?? item.Planned;

  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;

  return null;
}

async function engineering(env) {
  const apiKey =
    env.DISRUPTIONS_API_KEY || env.DARWIN_API_KEY;

  if (!apiKey) {
    return json(
      { error: 'Disruptions API key not configured' },
      503
    );
  }

  // Check all six stations.
  const checked = await Promise.all(
    STATIONS.map(async station => {
      try {
        const url =
          `${INCIDENTS_URL}?crsCode=${encodeURIComponent(station.crs)}`;

        const data = await getNationalRail(url, apiKey, 300);

        const disruptions =
          findStationDisruptions(data, station.crs);

        return {
          ...station,
          ok: true,
          disruptions
        };
      } catch (error) {
        return {
          ...station,
          ok: false,
          error: error.message,
          disruptions: []
        };
      }
    })
  );

  // Combine incidents that affect multiple stations.
  const byId = new Map();

  for (const station of checked) {
    for (const item of station.disruptions) {
      const id = identifier(item);

      const key =
        id == null ? JSON.stringify(item) : String(id);

      if (!byId.has(key)) {
        byId.set(key, {
          id: id == null ? null : String(id),
          planned: plannedStatus(item),
          affectedStations: [],
          details: item
        });
      }

      const record = byId.get(key);

      if (
        !record.affectedStations.some(
          s => s.crs === station.crs
        )
      ) {
        record.affectedStations.push({
          crs: station.crs,
          name: station.name
        });
      }
    }
  }

  const notices = [...byId.values()];

  return json(
    {
      generatedAt: new Date().toISOString(),
      station: 'Chislehurst',

      checkedStations: checked.map(
        ({ crs, name, ok, error, disruptions }) => ({
          crs,
          name,
          ok,
          ...(error ? { error } : {}),
          count: disruptions.length
        })
      ),

      engineeringWorks: notices.filter(
        n => n.planned === true
      ),

      otherDisruptions: notices.filter(
        n => n.planned === false
      ),

      unclassified: notices.filter(
        n => n.planned === null
      ),

      partialFailure: checked.some(s => !s.ok)
    },
    200,
    300
  );
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;

    if (path === '/engineering') {
      return engineering(env);
    }

    if (path !== '/departures') {
      return new Response('Not found', {
        status: 404,
        headers: CORS
      });
    }

    if (!env.DARWIN_API_KEY) {
      return json(
        { error: 'API key not configured' },
        503
      );
    }

    try {
      const data = await getNationalRail(
        DARWIN_URL,
        env.DARWIN_API_KEY,
        30
      );

      return json(data, 200, 30);
    } catch (error) {
      return json(
        { error: 'Unable to retrieve departures' },
        502
      );
    }
  }
};

