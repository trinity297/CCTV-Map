/**
 * Puts a handful of worked examples into the database so the app can be tried
 * out straight away. Safe to run more than once - it clears its own examples
 * first (they all carry the DEMO operation) and touches nothing else.
 *
 *   npm run seed
 */
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db.js';
import { RecordStore } from '../src/records.js';

const here = dirname(fileURLToPath(import.meta.url));
const dbFile = resolve(process.env.CCTV_MAP_DB || join(here, '..', 'data', 'cctv-map.db'));
const db = openDatabase(dbFile);
const store = new RecordStore(db);

const OPERATION = 'DEMO';

// A day-shift enquiry around Manchester city centre.
const day = (hhmm) => new Date(`2026-03-12T${hhmm}:00Z`).toISOString();

const examples = [
  {
    premises_name: 'Costcutter',
    address: '42 High Street',
    postcode: 'M1 2AB',
    lat: 53.48095, lng: -2.24260,
    status: 'obtained',
    reference: '01/123456/26',
    exhibit_ref: 'AB/1',
    footage_start: day('06:00'), footage_end: day('22:00'),
    collected_at: '2026-03-13T14:30:00.000Z',
    collected_by: 'PC 1234 Smith',
    system_type: 'DVR / NVR',
    retention_days: 28,
    quality: '1080p, good',
    media_format: 'MP4 on USB',
    storage_location: 'Axon Evidence — AB/1',
    contact_name: 'Mr Patel (manager)',
    contact_details: '0161 496 0000',
    what_covered: 'Shop floor, till, and the pavement outside',
    cameras: [
      { label: 'Cam 1 — front door', bearing: 270, fov: 90, range_m: 25, covers: 'Doorway and pavement outside' },
      { label: 'Cam 2 — till', bearing: 0, fov: 70, range_m: 8, covers: 'Till area', indoor: true },
    ],
    tags: 'town centre, retail',
    notes: 'Manager happy to assist. Ask at the counter; DVR is in the back office.',
  },
  {
    premises_name: 'The Griffin (public house)',
    address: '51 High Street',
    postcode: 'M1 2AB',
    lat: 53.48120, lng: -2.24190,
    status: 'obtained',
    reference: '01/123456/26',
    footage_start: day('18:00'), footage_end: day('23:59'),
    collected_at: '2026-03-13T16:05:00.000Z',
    collected_by: 'PC 1234 Smith',
    system_type: 'DVR / NVR',
    retention_days: 14,
    quality: '720p, some motion blur',
    storage_location: 'Axon Evidence — AB/2',
    what_covered: 'Beer garden and the junction outside',
    cameras: [
      { label: 'Cam 4 — car park', bearing: 200, fov: 110, range_m: 45, covers: 'Car park and the junction with Mill Lane' },
    ],
    tags: 'licensed premises',
    notes: 'Only 14 days retention — anything older than that is gone.',
  },
  {
    premises_name: 'Flat 3, Mill Lane (doorbell)',
    address: '8 Mill Lane',
    postcode: 'M1 2CD',
    lat: 53.48050, lng: -2.24310,
    status: 'viewed_only',
    reference: '01/123456/26',
    footage_start: day('19:30'), footage_end: day('20:15'),
    collected_at: '2026-03-14T09:20:00.000Z',
    collected_by: 'DC 5678 Okafor',
    system_type: 'Doorbell (Ring, Nest etc.)',
    retention_days: 30,
    quality: 'Good, but narrow view',
    what_covered: 'Front path and part of the road',
    cameras: [
      { label: 'Doorbell', bearing: 95, fov: 150, range_m: 12, covers: 'Front path, pavement and the near side of Mill Lane' },
    ],
    tags: 'residential',
    notes: 'Occupier showed the clip on her phone but would not send a copy. Return with a form.',
  },
  {
    premises_name: 'Mill Lane car park (local authority)',
    address: 'Mill Lane',
    postcode: 'M1 2CD',
    lat: 53.47990, lng: -2.24400,
    status: 'requested',
    reference: '01/123456/26',
    footage_start: day('17:00'), footage_end: day('23:00'),
    collected_at: null,
    collected_by: 'DC 5678 Okafor',
    system_type: 'Local authority / town centre',
    retention_days: 31,
    storage_location: 'Awaiting — council CCTV office',
    what_covered: 'Whole car park, both entrances',
    cameras: [
      { label: 'PTZ column 2', bearing: 45, fov: 360, range_m: 80, covers: 'Full pan-tilt-zoom, operator controlled' },
    ],
    tags: 'council',
    notes: 'Request submitted 14/03. Council say 5 working days.',
  },
  {
    premises_name: 'Newsagent, 12 Mill Lane',
    address: '12 Mill Lane',
    postcode: 'M1 2CD',
    lat: 53.48020, lng: -2.24350,
    status: 'no_footage',
    reference: '01/123456/26',
    collected_at: '2026-03-14T10:00:00.000Z',
    collected_by: 'DC 5678 Okafor',
    system_type: 'DVR / NVR',
    retention_days: 7,
    what_covered: 'Inside only',
    cameras: [
      { label: 'Cam 1', bearing: 180, fov: 80, range_m: 10, covers: 'Counter, faces into the shop', indoor: true },
    ],
    tags: 'retail',
    notes: 'Only 7 days retention and it had already overwritten. Cameras face inwards anyway.',
  },
  {
    premises_name: 'Bus stop camera (Stagecoach 192)',
    address: 'High Street / Mill Lane stop',
    postcode: 'M1 2AB',
    lat: 53.48070, lng: -2.24220,
    status: 'to_do',
    reference: '01/123456/26',
    footage_start: day('19:00'), footage_end: day('21:00'),
    system_type: 'Transport (bus, rail, taxi)',
    retention_days: 21,
    what_covered: 'Onboard and forward-facing road view',
    cameras: [],
    tags: 'transport',
    notes: 'Need the service and fleet number before the operator will search. Route 192 passes at ~19:40.',
  },
];

const existing = db
  .prepare('SELECT id FROM records WHERE operation = ?')
  .all(OPERATION);
for (const row of existing) store.remove(row.id, 'seed');

for (const example of examples) {
  store.create({ ...example, operation: OPERATION }, 'seed');
}

console.log(`Seeded ${examples.length} example records into ${dbFile}`);
console.log('They are all tagged with the operation "DEMO" — run this again to reset them,');
console.log('or filter on that operation and delete them once you are finished looking.');
db.close();
