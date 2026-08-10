// --- 1. CONFIGURATION & ÉTAT GLOBAL ---
const GIST_URL = 'https://gist.githubusercontent.com/gregorylaporte1810-gif/61f8993ec31c44df8058c3961078bee0/raw/8e7110629e8c6c9dafeb3cd05b607a7ec9faaaa8/radars.json';

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
      console.log('Radars chargés avec succès :', data.length);
      
      // Ajouter les marqueurs sur la carte
      radarsDatabase.forEach((radar) => {
        const marker = L.marker([radar.lat, radar.lon])
          .addTo(map)
          .bindPopup(`<b>${radar.nom}</b><br>Limite : ${radar.vitesseLimite} km/h`);
        radarMarkers.push(marker);
      });
    })
    .catch((error) => console.error('Erreur chargement radars :', error));
}

window.addEventListener("DOMContentLoaded", () => {
  initMap();
});

// --- 2. GESTION DU SON D'ALERTE (Web Audio API) ---
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
    console.log("Erreur lors de la lecture audio :", e);
  }
}

// --- 3. CALCUL DE DISTANCE (Formule de Haversine) ---
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

// --- 4. GESTION DES COULEURS D'ALERTE (Modèle React) ---
function mettreAJourCouleurAlerte(distance) {
  const headerEl = document.querySelector(".app-container header") || document.body;
  // Adaptation dynamique de la couleur selon la distance (identique au React)
  if (distance <= 500) {
    headerEl.style.backgroundColor = '#e74c3c'; // Rouge
  } else if (distance <= 1000) {
    headerEl.style.backgroundColor = '#e67e22'; // Orange
  } else {
    headerEl.style.backgroundColor = '#27ae60'; // Vert
  }
}

// --- 5. INITIALISATION PAR L'UTILISATEUR ---
const btnStart = document.getElementById("btn-start");
if (btnStart) {
  btnStart.addEventListener("click", function () {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    this.style.display = "none";
    demarrerGPS();
  });
}

// --- 6. SUIVI GPS TEMPS RÉEL ---
function demarrerGPS() {
  const statusBadge = document.getElementById("gps-status");
  const currentSpeedEl = document.getElementById("current-speed");
  const nextCameraDistEl = document.getElementById("next-camera-dist");
  const alertBanner = document.getElementById("alert-banner");
  const alertText = document.getElementById("alert-text");

  let isFirstPosition = true;

  if ("geolocation" in navigator) {
    if (statusBadge) {
      statusBadge.textContent = "GPS Actif";
      statusBadge.className = "status-badge actif";
    }

    navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, speed } = position.coords;
        const vitesseKmH = speed ? Math.round(speed * 3.6) : 0;

        if (currentSpeedEl) currentSpeedEl.innerHTML = `${vitesseKmH} <small>km/h</small>`;

        if (isFirstPosition && map) {
          map.setView([latitude, longitude], 15);
          isFirstPosition = false;
        }

        if (map) {
          if (!userMarker) {
            userMarker = L.circleMarker([latitude, longitude], {
              radius: 8,
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
          let radarConcerne = { nom: 'Aucun', vitesseLimite: '--' };

          radarsDatabase.forEach((radar) => {
            const distance = calculerDistance(latitude, longitude, radar.lat, radar.lon);
            if (distance < plusProcheDistance) {
              plusProcheDistance = distance;
              radarConcerne = radar;
            }
          });

          const distanceArrondie = Math.round(plusProcheDistance);
          if (nextCameraDistEl) {
            nextCameraDistEl.innerHTML = `${distanceArrondie} <small>m</small>`;
          }

          // Mise à jour de la couleur d'alerte selon les seuils du modèle React
          mettreAJourCouleurAlerte(distanceArrondie);

          if (distanceArrondie <= 500) {
            if (alertBanner) alertBanner.classList.remove("hidden");
            if (alertText) alertText.textContent = `⚠️ ${radarConcerne.nom} à ${distanceArrondie}m (Lim. ${radarConcerne.vitesseLimite} km/h)`;

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
        console.warn(`Code d'erreur GPS: ${error.code}, Message: ${error.message}`);
        if (statusBadge) {
          statusBadge.textContent = "Erreur GPS (" + error.code + ")";
          statusBadge.className = "status-badge erreur";
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20000,
      }
    );
  } else {
    if (statusBadge) {
      statusBadge.textContent = "GPS non supporté";
      statusBadge.className = "status-badge erreur";
    }
  }
}