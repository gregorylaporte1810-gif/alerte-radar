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
const GIST_URL =
  "https://gist.githubusercontent.com/gregorylaporte1810-gif/9b4eeb6c715a0bcde5644ad236d8d3f9/raw/bbe7399262869585ce05578e7d07aceaf0934f55/radars.json";

let map;
let userMarker;
let radarMarkers = [];
let radarsDatabase = [];
let audioCtx;
let dernierBipTime = 0;
let routingControl = null;
let destinationActuelle = null;
let derniereAnnonceVocale = 0;

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
  const heureArrivee = new Date(
    maintenant.getTime() + summary.totalTime * 1000,
  );
  const heureArriveeStr = heureArrivee.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

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
    document.getElementById("eta-label").textContent =
      `Arrivée à ${heureArriveeStr}`;
    document.getElementById("eta-value").textContent =
      `${tempsTexte} (${distanceKm} km)`;
  }

  const navControls = document.getElementById("navigation-controls");
  if (navControls) navControls.style.display = "block";
}

function tracerItineraire(start, destination) {
  destinationActuelle = destination;

  if (routingControl) {
    map.removeControl(routingControl);
  }

  // --- 1. LECTURE DES OPTIONS ---
  const sansPeage = document.getElementById("check-peage")?.checked;
  const sansAutoroute = document.getElementById("check-autoroute")?.checked;

  let exclusions = [];
  if (sansPeage) exclusions.push("toll");
  if (sansAutoroute) exclusions.push("motorway");

  // --- 2. CONFIGURATION DE MAPBOX ---
  const mapboxToken =
    "pk.eyJ1IjoiZ3JlZ29yeWJvZWhtYmVsaW4iLCJhIjoiY21zdHR6b2lmMGt5bzJ3cXV2ZXpoZW14dSJ9.tsmUFMuFvJpUDalG3GY3zQ";

  const routerMapbox = L.Routing.osrmv1({
    serviceUrl: "https://api.mapbox.com/directions/v5/mapbox/driving",
  });

  // On surcharge proprement l'URL tout en conservant le support OSRM de Leaflet
  routerMapbox.options.profile = "mapbox/driving";

  const originalBuildRouteUrl = routerMapbox.buildRouteUrl;
  routerMapbox.buildRouteUrl = function (waypoints, options) {
    let url = originalBuildRouteUrl.call(this, waypoints, options);
    url += "?access_token=" + mapboxToken;
    url += "&overview=full&steps=true&alternatives=true&language=fr";
    if (exclusions.length > 0) {
      url += "&exclude=" + exclusions.join(",");
    }
    return url;
  };

  // --- 3. LANCEMENT DU CALCUL ---
  routingControl = L.Routing.control({
    waypoints: [
      L.latLng(start.lat, start.lng),
      L.latLng(destination.lat, destination.lng),
    ],
    router: routerMapbox,
    language: "fr",
    show: false,
    routeWhileDragging: false,
    showAlternatives: true,
    altLineOptions: {
      styles: [{ opacity: 0, weight: 0 }],
    },
    fitSelectedRoutes: false,
    addWaypoints: false,
    lineOptions: {
      styles: [{ color: "#3498db", opacity: 0.85, weight: 7 }],
    },
    createMarker: function (i, wp, nWps) {
      if (i === nWps - 1) {
        return L.marker(wp.latLng);
      }
      return null;
    },
  }).addTo(map);

  // --- 4. AFFICHAGE DES RÉSULTATS ---
  routingControl.on("routesfound", function (e) {
    const activeRoute = e.routes[0];
    afficherInfosTrajet(activeRoute.summary);

    const instructionsContainer = document.getElementById(
      "instructions-container",
    );
    if (instructionsContainer) {
      instructionsContainer.innerHTML = "";

      if (e.routes.length > 1) {
        const titleDiv = document.createElement("div");
        titleDiv.style.fontWeight = "bold";
        titleDiv.style.marginBottom = "8px";
        titleDiv.textContent = "Choisir un itinéraire :";
        instructionsContainer.appendChild(titleDiv);

        const selectorContainer = document.createElement("div");
        selectorContainer.style.display = "flex";
        selectorContainer.style.gap = "8px";
        selectorContainer.style.marginBottom = "15px";

        e.routes.forEach((route, index) => {
          const distKm = (route.summary.totalDistance / 1000).toFixed(1);
          const mins = Math.round(route.summary.totalTime / 60);

          const btn = document.createElement("button");
          btn.textContent = `Option ${index + 1} : ${distKm} km (${mins} min)`;
          btn.style.padding = "8px 12px";
          btn.style.border = "1px solid #3498db";
          btn.style.borderRadius = "6px";
          btn.style.backgroundColor =
            route === activeRoute ? "#3498db" : "#fff";
          btn.style.color = route === activeRoute ? "#fff" : "#3498db";
          btn.style.cursor = "pointer";
          btn.style.fontWeight = "bold";

          btn.onclick = () => {
            routingControl.selectRoute(route);
          };

          selectorContainer.appendChild(btn);
        });

        instructionsContainer.appendChild(selectorContainer);
      }

      const listTitle = document.createElement("div");
      listTitle.style.fontWeight = "bold";
      listTitle.style.marginBottom = "8px";
      listTitle.textContent = "Feuille de route :";
      instructionsContainer.appendChild(listTitle);

      activeRoute.instructions.forEach((instruction) => {
        const div = document.createElement("div");
        div.style.padding = "8px 0";
        div.style.borderBottom = "1px solid #eee";
        div.innerHTML = `➡️ ${instruction.text} <small style="color:gray;">(${instruction.distance}m)</small>`;
        instructionsContainer.appendChild(div);
      });
    }
  });
}

function arreterGuidage() {
  if (routingControl) {
    map.removeControl(routingControl);
    routingControl = null;
  }
  destinationActuelle = null;

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

  // --- DÉTECTION JOUR / NUIT ---
  const heureActuelle = new Date().getHours();
  const estNuit = heureActuelle >= 20 || heureActuelle < 7;

  const tileUrl = estNuit
    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
    : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

  L.tileLayer(tileUrl, {
    maxZoom: 19,
    attribution: "© OpenStreetMap & CartoDB",
  }).addTo(map);

  // --- BARRE DE RECHERCHE D'ADRESSE (GEOCODER) ---
  if (L.Control.geocoder) {
    L.Control.geocoder({
      defaultMarkGeocode: false,
      placeholder: "Rechercher une adresse...",
      errorMessage: "Adresse introuvable",
    })
      .on("markgeocode", function (e) {
        if (!userMarker) {
          alert(
            "Veuillez d'abord lancer le GPS pour définir votre point de départ.",
          );
          return;
        }
        tracerItineraire(userMarker.getLatLng(), e.geocode.center);
      })
      .addTo(map);
  }

  // --- CHARGEMENT DES RADARS ---
  fetch(GIST_URL)
    .then((response) => response.json())
    .then((data) => {
      radarsDatabase = data
        .map((item) => {
          const latKey = Object.keys(item).find((k) => k.trim() === "Latitude");
          const lonKey = Object.keys(item).find(
            (k) => k.trim() === "Longitude",
          );
          const numKey = Object.keys(item).find(
            (k) => k.trim() === "Numéro de radar",
          );
          const typeKey = Object.keys(item).find(
            (k) => k.trim() === "Type de radar",
          );
          const dateKey = Object.keys(item).find(
            (k) => k.trim() === "Date de mise en service",
          );
          const vmaKey = Object.keys(item).find((k) => k.trim() === "VMA");

          const latStr = String(item[latKey] || "")
            .trim()
            .replace("+", "");
          const lonStr = String(item[lonKey] || "")
            .trim()
            .replace("+", "");
          const vmaVal = item[vmaKey];

          return {
            id: item[numKey],
            type: item[typeKey],
            dateMiseEnService: item[dateKey],
            vitesseLimite: vmaVal === "NA" ? "NA" : vmaVal,
            lat: parseFloat(latStr),
            lon: parseFloat(lonStr),
            nom: `${item[typeKey]} (${item[numKey]})`,
          };
        })
        .filter((radar) => !isNaN(radar.lat) && !isNaN(radar.lon));

      console.log(
        "Radars officiels chargés avec succès :",
        radarsDatabase.length,
      );

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

  if (map) {
    map.on("click", function (e) {
      if (!userMarker) {
        alert(
          "Veuillez d'abord lancer le GPS pour définir votre point de départ.",
        );
        return;
      }
      tracerItineraire(userMarker.getLatLng(), e.latlng);
    });
  }

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

// --- 4. GESTION DU SON D'ALERTE & SYNTHÈSE VOCALE ---
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

function annoncerRadarVocal(radar, distance) {
  const maintenant = Date.now();
  if (maintenant - derniereAnnonceVocale > 30000) {
    if ("speechSynthesis" in window) {
      const distanceMetres = Math.round(distance);
      const texte = `Attention, radar à ${distanceMetres} mètres. Vitesse limitée à ${radar.vitesseLimite}.`;

      const msg = new SpeechSynthesisUtterance(texte);
      msg.lang = "fr-FR";
      msg.rate = 1.1;
      window.speechSynthesis.speak(msg);

      derniereAnnonceVocale = maintenant;
    }
  }
}

// --- 5. CALCUL & FORMATAGE DE DISTANCE ---
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

        if (map) {
          map.setView([latitude, longitude], 17, { animate: true });

          const cap = position.coords.heading || 0;

          if (!userMarker) {
            userMarker = L.marker([latitude, longitude], {
              icon: carIcon,
            }).addTo(map);
          } else {
            userMarker.setLatLng([latitude, longitude]);
          }

          if (userMarker._icon) {
            userMarker._icon.style.transformOrigin = "center center";
            const baseTransform = userMarker._icon.style.transform.replace(
              /rotateZ\(.*?\)/g,
              "",
            );
            userMarker._icon.style.transform = `${baseTransform} rotateZ(${cap}deg)`;
          }

          if (routingControl && destinationActuelle) {
            const waypoints = routingControl.getWaypoints();
            waypoints[0].latLng = L.latLng(latitude, longitude);
            routingControl.setWaypoints(waypoints);
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
              distanceArrondie > 99999
                ? "Calcul..."
                : formatDistance(distanceArrondie);
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
              annoncerRadarVocal(radarConcerne, distanceArrondie);
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
      },
    );
  }
}

// --- 7. FAVORIS RAPIDES ---
function lancerFavori(lat, lng) {
  if (!userMarker) {
    alert("Veuillez d'abord lancer le GPS (Activer le GPS & l'Audio).");
    return;
  }
  const destination = { lat: lat, lng: lng };
  tracerItineraire(userMarker.getLatLng(), destination);
}
