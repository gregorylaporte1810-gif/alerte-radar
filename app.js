// --- ANTI-VEILLE ÉCRAN ---
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
      console.log("Verrouillage d'écran actif (anti-veille)");
    }
  } catch (err) {
    console.log(`Erreur Wake Lock: ${err.name}, ${err.message}`);
  }
}

document.addEventListener("visibilitychange", async () => {
  if (wakeLock !== null && document.visibilityState === "visible") {
    await requestWakeLock();
  }
});

// --- 1. CONFIGURATION & ÉTAT GLOBAL ---
const GIST_URL = "https://gist.githubusercontent.com/gregorylaporte1810-gif/61f8993ec31c44df8058c3961078bee0/raw/8e7110629e8c6c9dafeb3cd05b607a7ec9faaaa8/radars.json";

let map;
let userMarker;
let radarMarkers = [];
let radarsDatabase = [];
let audioCtx;
let dernierBipTime = 0;
let routingControl = null;
let destinationActuelle = null; // Stocke la destination choisie

const carIcon = L.icon({
  iconUrl: "voiture-removebg-preview.png",
  iconSize: [35, 35],
  iconAnchor: [17, 17],
});

// --- 2. FONCTIONS D'ITINÉRAIRE & NAVIGATION ---

function afficherInfosTrajet(summary) {
  const distanceKm = (summary.totalDistance / 1000).toFixed(1);
  const minutesTotales = Math.round(summary.totalTime / 60);
  const heures = Math.floor(minutesTotales / 60);
  const mins = minutesTotales % 60;
  
  let tempsTexte = heures > 0 ? `${heures}h ${mins}min` : `${mins} min`;

  const maintenant = new Date();
  const heureArrivee = new Date(maintenant.getTime() + summary.totalTime * 1000);
  const heureArriveeStr = heureArrivee.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Gestion de la boîte ETA dans le dashboard
  let etaBox = document.getElementById("eta-box");
  if (!etaBox) {
    const dashboard = document.querySelector(".dashboard");
    if (dashboard) {
      const sep = document.createElement("div");
      sep.className = "separator";
      sep.id = "eta-separator";
      dashboard.appendChild(sep);

      etaBox = document.createElement("div");
      etaBox.className = "box";
      etaBox.id = "eta-box";
      
      const label = document.createElement("span");
      label.className = "label";
      label.id = "eta-label";
      
      const value = document.createElement("span");
      value.className = "value";
      value.id = "eta-value";
      value.style.fontSize = "1.2rem";
      
      etaBox.appendChild(label);
      etaBox.appendChild(value);
      dashboard.appendChild(etaBox);
    }
  }

  if (etaBox) {
    document.getElementById("eta-label").textContent = `Arrivée à ${heureArriveeStr}`;
    document.getElementById("eta-value").textContent = `${tempsTexte} (${distanceKm} km)`;
  }

  // Afficher la barre de contrôle du guidage
  const navControls = document.getElementById("navigation-controls");
  if (navControls) navControls.style.display = "block";
}

function tracerItineraire(start, destination) {
  destinationActuelle = destination; // On mémorise la destination

  if (routingControl) {
    map.removeControl(routingControl);
  }

  routingControl = L.Routing.control({
    waypoints: [
      L.latLng(start.lat, start.lng),
      L.latLng(destination.lat, destination.lng)
    ],
    language: 'fr',
    routeWhileDragging: false,
    showAlternatives: false,
    fitSelectedRoutes: false,
    addWaypoints: false,
    lineOptions: {
      styles: [{ color: '#3498db', opacity: 0.85, weight: 7 }]
    },
    createMarker: function(i, wp, nWps) {
      if (i === nWps - 1) {
        return L.marker(wp.latLng);
      }
      return null;
    }
  }).addTo(map);

  // Écouter la création des routes pour récupérer les instructions textuelles et l'ETA
  routingControl.on('routesfound', function(e) {
    const route = e.routes[0];
    afficherInfosTrajet(route.summary);

    // Remplir la modale des détails
    const instructionsContainer = document.getElementById("instructions-container");
    if (instructionsContainer) {
      instructionsContainer.innerHTML = "";
      route.instructions.forEach(instruction => {
        const div = document.createElement("div");
        div.style.padding = "8px 0";
        div.style.borderBottom = "1px solid #eee";
        div.innerHTML = `➡️ ${instruction.text} <small style="color:gray;">(${instruction.distance}m)</small>`;
        instructionsContainer.appendChild(div);
      });
    }
  });
}

// Fonction pour stopper / effacer l'itinéraire
function arreterGuidage() {
  if (routingControl) {
    map.removeControl(routingControl);
    routingControl = null;
  }
  destinationActuelle = null;

  // Masquer les éléments de guidage
  const navControls = document.getElementById("navigation-controls");
  if (navControls) navControls.style.display = "none";

  const etaBox = document.getElementById("eta-box");
  const etaSep = document.getElementById("eta-separator");
  if (etaBox) etaBox.remove();
  if (etaSep) etaSep.remove();

  console.log("Guidage arrêté.");
}

// --- 3. INITIALISATION CARTE & ÉCOUTEURS ---
function initMap(lat = 46.603354, lon = 1.888334) {
  const mapContainer = document.getElementById("map");
  if (!mapContainer) return;

  map = L.map("map").setView([lat, lon], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  }).addTo(map);

  // Barre de recherche
  L.Control.geocoder({
    defaultMarkGeocode: false,
    placeholder: "Rechercher une adresse...",
    errorMessage: "Adresse introuvable",
  })
  .on("markgeocode", function (e) {
    if (!userMarker) {
      alert("Veuillez d'abord activer le GPS pour définir votre point de départ.");
      return;
    }
    tracerItineraire(userMarker.getLatLng(), e.geocode.center);
  })
  .addTo(map);

  // Chargement des radars
  fetch(GIST_URL)
    .then((response) => response.json())
    .then((data) => {
      radarsDatabase = data;
      console.log("Radars chargés avec succès :", data.length);
      radarsDatabase.forEach((radar) => {
        const marker = L.marker([radar.lat, radar.lon])
          .addTo(map)
          .bindPopup(`<b>${radar.nom}</b><br>Limite : ${radar.vitesseLimite} km/h`);
        radarMarkers.push(marker);
      });
    })
    .catch((error) => console.error("Erreur chargement radars :", error));
}

window.addEventListener("DOMContentLoaded", () => {
  initMap();

  // Clic sur la carte pour définir une destination
  map.on("click", function (e) {
    if (!userMarker) {
      alert("Veuillez d'abord lancer le GPS pour définir votre point de départ.");
      return;
    }
    tracerItineraire(userMarker.getLatLng(), e.latlng);
  });

  // Gestion des boutons de la modale et du guidage
  const btnStop = document.getElementById("btn-stop-nav");
  if (btnStop) {
    btnStop.addEventListener("click", arreterGuidage);
  }

  const btnDetails = document.getElementById("btn-details");
  const modal = document.getElementById("modal-details");
  const btnCloseModal = document.getElementById("btn-close-modal");

  if (btnDetails && modal) {
    btnDetails.addEventListener("click", () => {
      modal.style.display = "flex";
    });
  }

  if (btnCloseModal && modal) {
    btnCloseModal.addEventListener("click", () => {
      modal.style.display = "none";
    });
  }
});

// --- 4. GESTION DU SON D'ALERTE ---
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

// --- 5. CALCUL & FORMATAGE DE DISTANCE ---
function calculerDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;

  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(meters) {
  if (meters >= 1000) {
    return (meters / 1000).toFixed(1) + " km";
  } else {
    return Math.round(meters) + " m";
  }
}

function getAlertColor(dist) {
  if (dist <= 500) return "#e74c3c";
  if (dist <= 1000) return "#e67e22";
  return "#27ae60";
}

// --- 6. INITIALISATION GPS ---
const btnStart = document.getElementById("btn-start");
if (btnStart) {
  btnStart.addEventListener("click", function () {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    requestWakeLock();
    this.style.display = "none";
    demarrerGPS();
  });
}

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

        // Centrage carte (Zoom 17)
        if (map) {
          map.setView([latitude, longitude], 17, { animate: true });

          if (!userMarker) {
            userMarker = L.marker([latitude, longitude], { icon: carIcon }).addTo(map);
          } else {
            userMarker.setLatLng([latitude, longitude]);
          }

          // Mise à jour continue du départ de l'itinéraire si actif
          if (routingControl && destinationActuelle) {
            const waypoints = routingControl.getWaypoints();
            waypoints[0].latLng = L.latLng(latitude, longitude);
            routingControl.setWaypoints(waypoints);
          }
        }

        // Vérification des radars
        if (radarsDatabase.length > 0) {
          let plusProcheDistance = 999999;
          let radarConcerne = { nom: "Aucun", vitesseLimite: "--" };

          radarsDatabase.forEach((radar) => {
            const distance = calculerDistance(latitude, longitude, radar.lat, radar.lon);
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
            nextCameraDistEl.textContent = distanceArrondie > 99999 ? "Calcul..." : formatDistance(distanceArrondie);
          }

          const headerEl = document.getElementById("main-header");
          if (headerEl) {
            headerEl.style.backgroundColor = getAlertColor(distanceArrondie);
          }

          if (distanceArrondie <= 500) {
            if (alertBanner) alertBanner.classList.remove("hidden");
            if (alertText)
              alertText.textContent = `⚠️ ${radarConcerne.nom} à ${formatDistance(distanceArrondie)} (Lim. ${radarConcerne.vitesseLimite} km/h)`;

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
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000,
      }
    );
  }
}