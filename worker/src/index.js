
const DARWIN_BASE =
  'https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120/GetDepBoardWithDetails';

const DARWIN_URL = `${DARWIN_BASE}/CIT`;

const HOME_DARWIN_URL =
  `${DARWIN_BASE}/CHX?numRows=9`;

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

const CORS = {
  'Access-Control-Allow-Origin': '*'
};

function json(data, status = 200, maxAge = 0) {
  return Response.json(data, {
    status,
    headers: {
      ...CORS,
      'Cache-Control': maxAge
        ? `public, max-age=${maxAge}`
        : 'no-store'
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
    throw new Error(
      `National Rail HTTP ${response.status}`
    );
  }

  return response.json();
}

// Check whether a service calls at Chislehurst.
function callsAtChislehurst(service) {
  const groups = service.subsequentCallingPoints || [];

  return groups.some(group =>
    (group.callingPoint || []).some(point => {
      const crs = String(
        point.crs || point.crsCode || ''
      ).toUpperCase();

      const name = String(
        point.locationName || ''
      );

      return (
        crs === 'CIT' ||
        /chislehurst/i.test(name)
      );
    })
  );
}

// Extract disruptions for a particular station.
function findStationDisruptions(data, crs) {
  const entries = Array.isArray(data)
    ? data
    : [data];

  return entries
    .filter(entry =>
      entry && typeof entry === 'object'
    )
    .filter(entry =>
      !entry.crsCode || entry.crsCode === crs
    )
    .flatMap(entry =>
      Array.isArray(entry.disruptions)
        ? entry.disruptions
        : []
    );
}

function identifier(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  return (
    item.incidentNumber ??
    item.incidentId ??
    item.id ??
    null
  );
}

function plannedStatus(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const value = item.planned ?? item.Planned;

  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  return null;
}

// Engineering works and disruption endpoint.
async function engineering(env) {
  const apiKey =
    env.DISRUPTIONS_API_KEY ||
    env.DARWIN_API_KEY;

  if (!apiKey) {
    return json(
      { error: 'Disruptions API key not configured' },
      503
    );
  }

  const checked = await Promise.all(
    STATIONS.map(async station => {
      try {
        const url =
          `${INCIDENTS_URL}?crsCode=${
            encodeURIComponent(station.crs)
          }`;

        const data = await getNationalRail(
          url,
          apiKey,
          300
        );

        return {
          ...station,
          ok: true,
          disruptions: findStationDisruptions(
            data,
            station.crs
          )
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

  const byId = new Map();

  for (const station of checked) {
    for (const item of station.disruptions) {
      const id = identifier(item);

      const key = id == null
        ? JSON.stringify(item)
        : String(id);

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

  return json({
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

    partialFailure: checked.some(
      s => !s.ok
    )
  }, 200, 300);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;

    // Engineering works
    if (path === '/engineering') {
      return engineering(env);
    }

    // All departures from a selected station
    if (path === '/departures-station') {
      const crs = (new URL(request.url).searchParams.get('crs') || '')
        .trim()
        .toUpperCase();

      if (!/^[A-Z]{3}$/.test(crs)) {
        return json({ error: 'Invalid station code' }, 400);
      }

      if (!env.DARWIN_API_KEY) {
        return json({ error: 'API key not configured' }, 503);
      }

      try {
        const apiUrl = `${DARWIN_BASE}/${crs}?numRows=9`;
        const data = await getNationalRail(apiUrl, env.DARWIN_API_KEY, 30);
        return json(data, 200, 30);
      } catch (error) {
        return json({
          error: 'Unable to retrieve station departures',
          details: error.message
        }, 502);
      }
    }

    // Supported departure endpoints
    if (
      path !== '/departures' &&
      path !== '/departures-home'
    ) {
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
      const apiUrl =
        path === '/departures-home'
          ? HOME_DARWIN_URL
          : DARWIN_URL;

      const data = await getNationalRail(
        apiUrl,
        env.DARWIN_API_KEY,
        30
      );

      // Charing Cross to Chislehurst only
      if (path === '/departures-home') {
        const services = Array.isArray(
          data.trainServices
        )
          ? data.trainServices
          : [];

        data.trainServices = services.filter(
          callsAtChislehurst
        );
      }

      return json(data, 200, 30);

    } catch (error) {
      return json(
        {
          error: 'Unable to retrieve departures',
          details: error.message
        },
        502
      );
    }
  }
};
