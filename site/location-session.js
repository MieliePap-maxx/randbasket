(() => {
  const DEVICE_STATE_KEY = "randbasket-web-state-v1";
  const SESSION_LOCATION_KEY = "randbasket-session-location-v1";
  const CHANNEL_NAME = "randbasket-location";
  const INSTANCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function validLocation(value) {
    if (!value || typeof value !== "object") return null;
    const latitude = Number(value.latitude);
    const longitude = Number(value.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
    return {
      latitude,
      longitude,
      accuracy: Number(value.accuracy) || undefined,
      updatedAt: value.updatedAt || new Date().toISOString(),
    };
  }

  function read() {
    try {
      return validLocation(JSON.parse(sessionStorage.getItem(SESSION_LOCATION_KEY) || "null"));
    } catch {
      return null;
    }
  }

  function broadcast(location) {
    if (!("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ type: "location", location, source: INSTANCE_ID });
    channel.close();
  }

  function write(value, shouldBroadcast = true) {
    const location = validLocation(value);
    if (!location) return null;
    sessionStorage.setItem(SESSION_LOCATION_KEY, JSON.stringify(location));
    if (shouldBroadcast) broadcast(location);
    return location;
  }

  function clear(shouldBroadcast = true) {
    sessionStorage.removeItem(SESSION_LOCATION_KEY);
    if (shouldBroadcast) broadcast(null);
  }

  function readDeviceState() {
    try {
      const value = JSON.parse(localStorage.getItem(DEVICE_STATE_KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }

  function permission() {
    return String(readDeviceState().settings?.locationPermission || "");
  }

  function setPermission(value) {
    const deviceState = readDeviceState();
    deviceState.settings = deviceState.settings && typeof deviceState.settings === "object"
      ? deviceState.settings
      : {};
    deviceState.settings.locationPermission = value;
    delete deviceState.settings.location;
    localStorage.setItem(DEVICE_STATE_KEY, JSON.stringify(deviceState));
  }

  function request() {
    return new Promise((resolve, reject) => {
      if (!("geolocation" in navigator)) {
        reject(new Error("Location is unavailable in this browser"));
        return;
      }
      navigator.geolocation.getCurrentPosition((position) => {
        resolve(validLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          updatedAt: new Date().toISOString(),
        }));
      }, reject, { enableHighAccuracy: false, maximumAge: 900000, timeout: 12000 });
    });
  }

  function query(value = read()) {
    const location = validLocation(value);
    if (!location) return "";
    return `&latitude=${encodeURIComponent(location.latitude)}&longitude=${encodeURIComponent(location.longitude)}`;
  }

  function subscribe(listener) {
    if (!("BroadcastChannel" in window)) return () => {};
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", (event) => {
      if (event.data?.type !== "location" || event.data.source === INSTANCE_ID) return;
      if (event.data.location) write(event.data.location, false);
      else clear(false);
      listener(read());
    });
    return () => channel.close();
  }

  window.RandBasketLocation = {
    clear,
    permission,
    query,
    read,
    request,
    setPermission,
    subscribe,
    validLocation,
    write,
  };
})();
