// --- ANTI-VEILLE ÉCRAN ---
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Verrouillage d\'écran actif (anti-veille)');
    }
  } catch (err) {
    console.log(`Erreur Wake Lock: ${err.name}, ${err.message}`);
  }
}

// Réactiver le Wake Lock si l'utilisateur revient sur l'onglet
document.addEventListener('visibilitychange', async () => {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    await requestWakeLock();
  }
});

// --- 1. CONFIGURATION & ÉTAT GLOBAL ---
const GIST_URL = "https://gist.githubusercontent.com/gregorylaporte1810-gif/9b4eeb6c715a0bcde5644ad236d8d3f9/raw/7bb5e292d96fa0c1163cd005ea70ef8ebc0a1cc0/radars.json";
let map;
let userMarker;
let radarMarkers = [];
let radarsDatabase = [];
let audioCtx;
let dernierBipTime = 0;

// Initialisation de la carte Leaflet
function initMap(lat = 46.603354, lon = 1.888334) {
  const mapContainer = document.getElementById("map");
  if (!mapContainer) return;

  map = L.map("map").setView([lat, lon], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  }).addTo(map);

  // Charger les radars depuis le Gist GitHub
  fetch(GIST_URL)
    .then((response) => response.json())
    .then((data) => {
      radarsDatabase = data;
      console.log("Radars chargés avec succès :", data.length);

      radarsDatabase.forEach((radar) => {
        const marker = L.marker([radar.lat, radar.lon])
          .addTo(map)
          .bindPopup(
            `<b>${radar.nom}</b><br>Limite : ${radar.vitesseLimite} km/h`,
          );
        radarMarkers.push(marker);
      });
    })
    .catch((error) => console.error("Erreur chargement radars :", error));
}

window.addEventListener("DOMContentLoaded", () => {
  initMap();
});

// --- 2. GESTION DU SON D'ALERTE ---
function jouerBipAlerte() {
  if (!audioCtx) return;

  try {
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.2);
  } catch (e) {
    console.log("Erreur audio :", e);
  }
}

// --- 3. CALCUL DE DISTANCE (Haversine) ---
function calculerDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// --- 4. GESTION DES COULEURS ---
function getAlertColor(dist) {
  if (dist <= 500) return "#e74c3c"; // Rouge
  if (dist <= 1000) return "#e67e22"; // Orange
  return "#27ae60"; // Vert
}

// --- 5. INITIALISATION UTILISATEUR ---
const btnStart = document.getElementById("btn-start");
if (btnStart) {
  btnStart.addEventListener("click", function () {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    
    // Active l'anti-veille écran ici
    requestWakeLock();

    this.style.display = "none";
    demarrerGPS();
  });
}

// --- 6. SUIVI GPS TEMPS RÉEL & SUIVI CARTE ---
function demarrerGPS() {
  const statusBadge = document.getElementById("gps-status");
  const currentSpeedEl = document.getElementById("current-speed");
  const nextCameraDistEl = document.getElementById("next-camera-dist");
  const nextRadarLabelEl = document.getElementById("next-radar-label");
  const alertBanner = document.getElementById("alert-banner");
  const alertText = document.getElementById("alert-text");

  if ("geolocation" in navigator) {
    if (statusBadge) {
      statusBadge.textContent = "GPS Actif";
      statusBadge.className = "status-badge actif";
    }

    navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, speed } = position.coords;
        const vitesseKmH = speed ? Math.round(speed * 3.6) : 0;

        if (currentSpeedEl)
          currentSpeedEl.innerHTML = `${vitesseKmH} <small class="unit">km/h</small>`;

        // Centrage dynamique de la carte en continu pour suivre le véhicule
        if (map) {
          map.setView([latitude, longitude], 16);

          if (!userMarker) {
            userMarker = L.circleMarker([latitude, longitude], {
              radius: 9,
              color: "#3b82f6",
              fillColor: "#60a5fa",
              fillOpacity: 1,
            }).addTo(map);
          } else {
            userMarker.setLatLng([latitude, longitude]);
          }
        }

        if (radarsDatabase.length > 0) {
          let plusProcheDistance = 999999;
          let radarConcerne = { nom: "Aucun", vitesseLimite: "--" };

          radarsDatabase.forEach((radar) => {
            const distance = calculerDistance(
              latitude,
              longitude,
              radar.lat,
              radar.lon,
            );
            if (distance < plusProcheDistance) {
              plusProcheDistance = distance;
              radarConcerne = radar;
            }
          });

          const distanceArrondie = Math.round(plusProcheDistance);

          if (nextRadarLabelEl) {
            nextRadarLabelEl.textContent = `Prochain Radar (${radarConcerne.vitesseLimite} km/h)`;
          }

          if (nextCameraDistEl) {
            nextCameraDistEl.textContent =
              distanceArrondie > 99999 ? "Calcul..." : `${distanceArrondie} m`;
          }

          const headerEl = document.getElementById("main-header");
          if (headerEl) {
            headerEl.style.backgroundColor = getAlertColor(distanceArrondie);
          }

          // Gestion de la bannière d'alerte visuelle et sonore
          if (distanceArrondie <= 500) {
            if (alertBanner) alertBanner.classList.remove("hidden");
            if (alertText)
              alertText.textContent = `⚠️ ${radarConcerne.nom} à ${distanceArrondie}m (Lim. ${radarConcerne.vitesseLimite} km/h)`;

            const maintenant = Date.now();
            if (maintenant - dernierBipTime > 2000) {
              jouerBipAlerte();
              dernierBipTime = maintenant;
            }
          } else {
            if (alertBanner) alertBanner.classList.add("hidden");
          }
        }
      },
      (error) => {
        console.warn(`Erreur GPS: ${error.message}`);
        if (statusBadge) {
          statusBadge.textContent = "Erreur GPS (" + error.code + ")";
          statusBadge.className = "status-badge erreur";
        }
      },
      {
        enableHighAccuracy: false,
        maximumAge: 10000,
        timeout: 30000,
      },
    );
  }
}
