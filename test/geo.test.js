import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceMetres, boundingBox, bearingBetween, bearingWithinView, compassLabel } from '../src/geo.js';

test('distance between two known points', () => {
  // Manchester Piccadilly to Manchester Victoria: roughly 1.2 km.
  const d = distanceMetres(53.4774, -2.2309, 53.4874, -2.2424);
  assert.ok(d > 1000 && d < 1500, `expected ~1.2km, got ${Math.round(d)}m`);
});

test('distance is zero for the same point', () => {
  assert.equal(Math.round(distanceMetres(53.5, -2.2, 53.5, -2.2)), 0);
});

test('bounding box contains every point within the radius', () => {
  const lat = 53.48;
  const lng = -2.24;
  const radius = 500;
  const box = boundingBox(lat, lng, radius);
  for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
    const rad = (bearing * Math.PI) / 180;
    // Walk out to the radius in each direction and check the box holds it.
    const dLat = (radius * Math.cos(rad)) / 111320;
    const dLng = (radius * Math.sin(rad)) / (111320 * Math.cos((lat * Math.PI) / 180));
    assert.ok(lat + dLat <= box.maxLat + 1e-9 && lat + dLat >= box.minLat - 1e-9);
    assert.ok(lng + dLng <= box.maxLng + 1e-9 && lng + dLng >= box.minLng - 1e-9);
  }
});

test('bearing between points', () => {
  assert.equal(Math.round(bearingBetween(53.0, -2.0, 54.0, -2.0)), 0);   // due north
  assert.equal(Math.round(bearingBetween(53.0, -2.0, 53.0, -1.0)), 90);  // due east
  assert.equal(Math.round(bearingBetween(53.0, -2.0, 52.0, -2.0)), 180); // due south
});

test('field of view test wraps around north', () => {
  assert.ok(bearingWithinView(350, 60, 10), 'a camera facing 350 should see 10');
  assert.ok(bearingWithinView(10, 60, 350), 'a camera facing 10 should see 350');
  assert.ok(!bearingWithinView(0, 60, 180), 'a north-facing camera should not see south');
});

test('unknown direction is never ruled out', () => {
  assert.ok(bearingWithinView(null, 60, 180));
});

test('compass labels', () => {
  assert.equal(compassLabel(0), 'N');
  assert.equal(compassLabel(90), 'E');
  assert.equal(compassLabel(181), 'S');
  assert.equal(compassLabel(315), 'NW');
  assert.equal(compassLabel(359), 'N');
  assert.equal(compassLabel(null), '');
});
