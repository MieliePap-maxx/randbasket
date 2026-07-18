import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

class TestBroadcastChannel {
  addEventListener() {}
  close() {}
  postMessage() {}
}

const source = await readFile(new URL("./location-session.js", import.meta.url), "utf8");
const sessionStorage = storage();
const localStorage = storage();
localStorage.setItem("randbasket-web-state-v1", JSON.stringify({
  items: [{ id: "milk" }],
  settings: { location: { latitude: 1, longitude: 2 }, stores: { spar: true } },
}));
const window = { BroadcastChannel: TestBroadcastChannel };
const sandbox = {
  BroadcastChannel: TestBroadcastChannel,
  localStorage,
  navigator: {
    geolocation: {
      getCurrentPosition(success) {
        success({ coords: { latitude: -26.1, longitude: 28.05, accuracy: 20 } });
      },
    },
  },
  sessionStorage,
  window,
};
vm.runInNewContext(source, sandbox, { filename: "location-session.js" });

const location = window.RandBasketLocation.write({ latitude: -26.2, longitude: 28.04, accuracy: 15 });
assert.equal(window.RandBasketLocation.read().latitude, -26.2);
assert.match(window.RandBasketLocation.query(location), /latitude=-26\.2&longitude=28\.04/);

window.RandBasketLocation.setPermission("granted");
const saved = JSON.parse(localStorage.getItem("randbasket-web-state-v1"));
assert.equal(saved.settings.locationPermission, "granted");
assert.equal("location" in saved.settings, false, "coordinates must never be written to permanent device state");
assert.equal(saved.items[0].id, "milk", "updating permission must preserve basket state");

const requested = await window.RandBasketLocation.request();
assert.equal(requested.latitude, -26.1);
assert.equal(requested.longitude, 28.05);

window.RandBasketLocation.clear();
assert.equal(window.RandBasketLocation.read(), null);

console.log("Session-only location tests passed.");
