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
const API_URL = "https://alerte-radar.onrender.com/api/radars";
const MAPBOX_TOKEN =
  "pk.eyJ1IjoiZ3JlZ29yeWJvZWhtYmVsaW4iLCJhIjoiY21zdHR6b2lmMGt5bzJ3cXV2ZXpoZW14dSJ9.tsmUFMuFvJpUDalG3GY3zQ";
let toleranceActive = localStorage.getItem("gps_tolerance") || "0";

let map;
let userMarker;
let userCarElement;
let destMarker = null;
let radarMarkers = [];
let radarsDatabase = [];
let audioCtx;
let dernierBipTime = 0;
let destinationActuelle = null;
let derniereAnnonceVocale = 0;
let voiceGuidanceEnabled = false;
let derniereLat = null;
let derniereLon = null;
let dernierCap = 0;
let instructionsActuelles = [];
let routeCoordinates = []; // [[lng, lat], ...]
let indexInstructionActuelle = 0;
let heureArriveeEstimee = null;
let distanceRestanteMetres = 0;
let recalculEnCours = false;
let suiviAutoActif = true;
let radarsProches = []; // Ne contiendra que les radars dans un rayon de 20 km
let derniereLatMajRadars = null;
let derniereLonMajRadars = null;


// --- 2. FONCTIONS D'ITINÉRAIRE & NAVIGATION ---

function afficherInfosTrajet(summary) {
  distanceRestanteMetres = summary.distance;
  const maintenant = new Date();
  heureArriveeEstimee = new Date(
    maintenant.getTime() + summary.duration * 1000,
  );

  const distanceKm = (distanceRestanteMetres / 1000).toFixed(1);
  const minutesTotales = Math.round(summary.duration / 60);
  const heures = Math.floor(minutesTotales / 60);
  const mins = minutesTotales % 60;

  let tempsTexte = heures > 0 ? `${heures}h ${mins}min` : `${mins} min`;
  const heureArriveeStr = heureArriveeEstimee.toLocaleTimeString([], {
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
  if (navControls) navControls.style.display = "flex";
}

function tracerItineraire(start, destination) {
  destinationActuelle = destination;
  document.getElementById("favorites-bar").style.display = "none";
  document.getElementById("route-options").style.display = "none";
  document.body.classList.add("nav-active");

  if (map) {
    setTimeout(() => {
      map.resize();
      if (userMarker) {
        const coords = userMarker.getLngLat();
        map.easeTo({
          center: [coords.lng, coords.lat],
          zoom: 17,
          pitch: 60,
          bearing: dernierCap,
          duration: 1000,
        });
      }
    }, 150);
  }

  if (destMarker) destMarker.remove();
  destMarker = new mapboxgl.Marker({ color: "#e74c3c" })
    .setLngLat([destination.lng, destination.lat])
    .addTo(map);

  const sansPeage = document.getElementById("check-peage")?.checked;
  const sansAutoroute = document.getElementById("check-autoroute")?.checked;

  let exclusions = [];
  if (sansPeage) exclusions.push("toll");
  if (sansAutoroute) exclusions.push("motorway");

  let url = `https://api.mapbox.com/directions/v5/mapbox/driving/${start.lng},${start.lat};${destination.lng},${destination.lat}?access_token=${MAPBOX_TOKEN}&geometries=geojson&overview=full&steps=true&language=fr`;

  if (exclusions.length > 0) {
    url += `&exclude=${exclusions.join(",")}&alternatives=false`;
  } else {
    url += `&alternatives=true`;
  }

  fetch(url)
    .then((res) => res.json())
    .then((data) => {
      if (!data.routes || data.routes.length === 0) return;

      const routes = data.routes;
      const instructionsContainer = document.getElementById(
        "instructions-container",
      );

      function afficherRouteSelectionnee(index) {
        const activeRoute = routes[index];
        routeCoordinates = activeRoute.geometry.coordinates;

        instructionsActuelles = [];
        if (
          activeRoute.legs &&
          activeRoute.legs[0] &&
          activeRoute.legs[0].steps
        ) {
          instructionsActuelles = activeRoute.legs[0].steps.map((step) => ({
            text: step.maneuver.instruction,
            distance: step.distance,
            location: step.maneuver.location,
          }));
        }

        indexInstructionActuelle = 1;

        afficherInfosTrajet({
          distance: activeRoute.distance,
          duration: activeRoute.duration,
        });

        dessinerRouteSurCarte(activeRoute.geometry);

        if (!instructionsContainer) return;
        instructionsContainer.innerHTML = "";

        if (routes.length > 1) {
          const titleDiv = document.createElement("div");
          titleDiv.style.fontWeight = "bold";
          titleDiv.style.marginBottom = "8px";
          titleDiv.textContent = "Choisir un itinéraire :";
          instructionsContainer.appendChild(titleDiv);

          const selectorContainer = document.createElement("div");
          selectorContainer.style.display = "flex";
          selectorContainer.style.gap = "8px";
          selectorContainer.style.marginBottom = "15px";

          routes.forEach((route, idx) => {
            const distKm = (route.distance / 1000).toFixed(1);
            const mins = Math.round(route.duration / 60);

            const btn = document.createElement("button");
            btn.textContent = `Option ${idx + 1} : ${distKm} km (${mins} min)`;
            btn.style.padding = "8px 12px";
            btn.style.border = "1px solid #3498db";
            btn.style.borderRadius = "6px";

            const isSelected = idx === index;
            btn.style.backgroundColor = isSelected ? "#3498db" : "#fff";
            btn.style.color = isSelected ? "#fff" : "#3498db";
            btn.style.cursor = "pointer";
            btn.style.fontWeight = "bold";

            btn.onclick = () => afficherRouteSelectionnee(idx);
            selectorContainer.appendChild(btn);
          });

          instructionsContainer.appendChild(selectorContainer);
        }

        const listTitle = document.createElement("div");
        listTitle.style.fontWeight = "bold";
        listTitle.style.marginBottom = "8px";
        listTitle.textContent = "Feuille de route :";
        instructionsContainer.appendChild(listTitle);

        instructionsActuelles.forEach((inst) => {
          const div = document.createElement("div");
          div.style.padding = "8px 0";
          div.style.borderBottom = "1px solid #eee";
          const distM = Math.round(inst.distance);
          div.innerHTML = `➡️ ${inst.text} <small style="color:gray;">(${distM}m)</small>`;
          instructionsContainer.appendChild(div);
        });
      }

      afficherRouteSelectionnee(0);

      if (instructionsActuelles.length > 0) {
        annoncerTexte("Itinéraire calculé. " + instructionsActuelles[0].text);
      }
    })
    .catch((err) => console.error("Erreur calcul itinéraire Mapbox :", err));
}

function dessinerRouteSurCarte(geometry) {
  const geojson = {
    type: "Feature",
    properties: {},
    geometry: geometry,
  };

  if (map.getSource("route")) {
    map.getSource("route").setData(geojson);
  } else {
    map.addSource("route", {
      type: "geojson",
      data: geojson,
    });

    map.addLayer({
      id: "route",
      type: "line",
      source: "route",
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#3498db",
        "line-width": 8,
        "line-opacity": 0.85,
      },
    });
  }
}

function arreterGuidage() {
  if (map.getLayer("route")) map.removeLayer("route");
  if (map.getSource("route")) map.removeSource("route");

  if (destMarker) {
    destMarker.remove();
    destMarker = null;
  }

  destinationActuelle = null;
  document.getElementById("favorites-bar").style.display = "flex";
  document.getElementById("route-options").style.display = "flex";

  const navControls = document.getElementById("navigation-controls");
  if (navControls) navControls.style.display = "none";

  const etaBox = document.getElementById("eta-box");
  const etaSep = document.getElementById("eta-separator");
  if (etaBox) etaBox.remove();
  if (etaSep) etaSep.remove();
  document.body.classList.remove("nav-active");

  if (derniereLat !== null && derniereLon !== null) {
    map.easeTo({
      center: [derniereLon, derniereLat],
      zoom: 15,
      pitch: 0,
      bearing: 0,
      duration: 1000,
    });
  }

  console.log("Guidage arrêté.");
}

// --- 3. INITIALISATION CARTE MAPBOX GL JS ---
function initMap(lat = 46.603354, lon = 1.888334) {
  const mapContainer = document.getElementById("map");
  if (!mapContainer) return;

  mapboxgl.accessToken = MAPBOX_TOKEN;

  const heureActuelle = new Date().getHours();
  const estNuit = heureActuelle >= 20 || heureActuelle < 7;
  const styleUrl = estNuit
    ? "mapbox://styles/mapbox/navigation-night-v1"
    : "mapbox://styles/mapbox/navigation-day-v1";

  map = new mapboxgl.Map({
    container: "map",
    style: styleUrl,
    center: [lon, lat],
    zoom: 16,
    pitch: 60, // Inclinaison 3D cockpit
    bearing: 0,
    antialias: true,
  });

  map.on("load", () => {
    fetch(API_URL)
      .then((response) => response.json())
      .then((data) => {
        radarsDatabase = data
          .map((item) => ({
            id: item.id,
            type: item.type,
            dateMiseEnService: item.date_mise_en_service,
            vitesseLimite:
              item.vitesse_limite === "NA" ? "NA" : item.vitesse_limite,
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon),
            nom: `${item.type} (${item.id})`,
          }))
          .filter((radar) => !isNaN(radar.lat) && !isNaN(radar.lon));

        console.log("Radars chargés depuis l'API :", radarsDatabase.length);

        radarsDatabase.forEach((radar) => {
          const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(
            `<b>${radar.nom}</b><br>Limite : ${radar.vitesseLimite} km/h`,
          );
          const marker = new mapboxgl.Marker({ color: "#e74c3c" })
            .setLngLat([radar.lon, radar.lat])
            .setPopup(popup)
            .addTo(map);

          radarMarkers.push(marker);
        });
      })
      .catch((error) => console.error("Erreur connexion API radars :", error));

    const loader = document.getElementById("loading-radars");
    if (loader) loader.style.display = "none";
  });
}

window.addEventListener("DOMContentLoaded", () => {
  chargerFavorisStorage();
  initMap();

  const btnTheme = document.getElementById("btn-theme");
  const isDarkMode = localStorage.getItem("gps_theme") === "dark";

  if (isDarkMode) {
    document.body.classList.add("dark-mode");
    if (btnTheme) btnTheme.textContent = "☀️";
  }

  if (btnTheme) {
    btnTheme.addEventListener("click", () => {
      document.body.classList.toggle("dark-mode");
      const isDark = document.body.classList.contains("dark-mode");
      localStorage.setItem("gps_theme", isDark ? "dark" : "light");
      btnTheme.textContent = isDark ? "☀️" : "🌙";

      if (map) {
        map.setStyle(
          isDark
            ? "mapbox://styles/mapbox/navigation-night-v1"
            : "mapbox://styles/mapbox/navigation-day-v1",
        );
      }
    });
  }

  const selectTolerance = document.getElementById("tolerance-select");
  if (selectTolerance) {
    selectTolerance.value = toleranceActive;
    selectTolerance.addEventListener("change", (e) => {
      toleranceActive = e.target.value;
      localStorage.setItem("gps_tolerance", toleranceActive);
    });
  }

  // RECENTRAGE MANUEL
  document.getElementById("map")?.addEventListener("mousedown", () => {
    suiviAutoActif = false;
    const btnRecentrer = document.getElementById("btn-recentrer");
    if (btnRecentrer) btnRecentrer.style.display = "block";
  });

  document.getElementById("map")?.addEventListener("touchstart", () => {
    suiviAutoActif = false;
    const btnRecentrer = document.getElementById("btn-recentrer");
    if (btnRecentrer) btnRecentrer.style.display = "block";
  });

  const btnRecentrer = document.getElementById("btn-recentrer");
  if (btnRecentrer) {
    btnRecentrer.addEventListener("click", () => {
      suiviAutoActif = true;
      btnRecentrer.style.display = "none";
      if (derniereLat !== null && derniereLon !== null) {
        map.easeTo({
          center: [derniereLon, derniereLat],
          zoom: 17,
          pitch: 60,
          bearing: dernierCap,
          duration: 500,
        });
      }
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

  const btnVoiceToggle = document.getElementById("btn-voice-toggle");
  if (btnVoiceToggle) {
    btnVoiceToggle.addEventListener("click", () => {
      voiceGuidanceEnabled = !voiceGuidanceEnabled;
      if (voiceGuidanceEnabled) {
        btnVoiceToggle.textContent = "🔊 Voix : ON";
        btnVoiceToggle.style.backgroundColor = "#27ae60";
        annoncerTexte("Guidage vocal activé.");
      } else {
        btnVoiceToggle.textContent = "🔇 Voix : OFF";
        btnVoiceToggle.style.backgroundColor = "#e74c3c";
        if ("speechSynthesis" in window) {
          window.speechSynthesis.cancel();
        }
      }
    });
  }

  const checkPeage = document.getElementById("check-peage");
  const checkAutoroute = document.getElementById("check-autoroute");

  function actualiserFiltresRoute() {
    if (destinationActuelle && userMarker) {
      const pos = userMarker.getLngLat();
      tracerItineraire({ lat: pos.lat, lng: pos.lng }, destinationActuelle);
    }
  }

  if (checkPeage) checkPeage.addEventListener("change", actualiserFiltresRoute);
  if (checkAutoroute)
    checkAutoroute.addEventListener("change", actualiserFiltresRoute);
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

// Filtre la base de données pour ne garder que les radars autour de l'utilisateur
function mettreAJourRadarsProches(userLat, userLon) {
  // On filtre pour ne garder que les radars à moins de 20 km (20000 mètres)
  radarsProches = radarsDatabase.filter((radar) => {
    // 🚀 OPTIMISATION EXTRÊME : Filtre "carré" rapide avant le calcul précis
    // 1 degré de latitude vaut environ 111 km. 0.2 degré = ~22 km.
    const dLat = Math.abs(radar.lat - userLat);
    const dLon = Math.abs(radar.lon - userLon);
    
    // Si le radar est à plus de ~22km de base, on l'ignore sans faire le calcul complexe
    if (dLat > 0.2 || dLon > 0.2) return false;
    
    // Si le radar est dans le carré proche, on fait le vrai calcul précis de Haversine
    const dist = calculerDistance(userLat, userLon, radar.lat, radar.lon);
    return dist <= 20000;
  });
  
  derniereLatMajRadars = userLat;
  derniereLonMajRadars = userLon;
  console.log(`[Optimisation] Zone radar mise à jour : ${radarsProches.length} radars surveillés.`);
}

// Calcule la vraie distance par rapport au tracé de la route
function distancePointSegment(lat, lon, lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const rad = Math.PI / 180;

  // Approximation plane pour de courtes distances
  const x0 = lon * rad * Math.cos(lat * rad);
  const y0 = lat * rad;
  const x1 = lon1 * rad * Math.cos(lat1 * rad);
  const y1 = lat1 * rad;
  const x2 = lon2 * rad * Math.cos(lat2 * rad);
  const y2 = lat2 * rad;

  const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (l2 === 0) return calculerDistance(lat, lon, lat1, lon1);

  let t = ((x0 - x1) * (x2 - x1) + (y0 - y1) * (y2 - y1)) / l2;
  t = Math.max(0, Math.min(1, t));

  const projX = x1 + t * (x2 - x1);
  const projY = y1 + t * (y2 - y1);

  const projLat = projY / rad;
  const projLon = projX / rad / Math.cos(lat * rad);

  return calculerDistance(lat, lon, projLat, projLon);
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

function annoncerTexte(texte) {
  if (!voiceGuidanceEnabled || !("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();
  const msg = new SpeechSynthesisUtterance(texte);
  msg.lang = "fr-FR";
  msg.rate = 1.1;
  window.speechSynthesis.speak(msg);
}

// --- 6. INITIALISATION GPS & SUIVI TEMPS RÉEL ---
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

        if (currentSpeedEl) {
          currentSpeedEl.textContent = vitesseKmH;
        }

        const speedGauge = document.getElementById("speed-gauge");
        if (speedGauge) {
          const maxSpeed = 180;
          let fillPercentage = vitesseKmH / maxSpeed;
          if (fillPercentage > 1) fillPercentage = 1;

          const offset = 314 - 314 * fillPercentage;
          speedGauge.style.strokeDashoffset = offset;
        }

        if (derniereLat !== null && derniereLon !== null) {
          const dLat = latitude - derniereLat;
          const dLon = longitude - derniereLon;
          const distanceParcourue = calculerDistance(
            derniereLat,
            derniereLon,
            latitude,
            longitude,
          );

          if (distanceRestanteMetres > 0 && distanceParcourue > 0) {
            distanceRestanteMetres -= distanceParcourue;
            if (distanceRestanteMetres < 0) distanceRestanteMetres = 0;

            if (heureArriveeEstimee) {
              const maintenant = new Date();
              let tempsRestantMs = heureArriveeEstimee - maintenant;
              if (tempsRestantMs < 0) tempsRestantMs = 0;

              const minutesRestantes = Math.round(tempsRestantMs / 60000);
              const heures = Math.floor(minutesRestantes / 60);
              const mins = minutesRestantes % 60;
              const tempsTexte =
                heures > 0 ? `${heures}h ${mins}min` : `${mins} min`;
              const distKm = (distanceRestanteMetres / 1000).toFixed(1);

              const etaValueEl = document.getElementById("eta-value");
              if (etaValueEl) {
                etaValueEl.textContent = `${tempsTexte} (${distKm} km)`;
              }
            }
          }

          if (distanceParcourue > 0.5) {
            let angle = Math.atan2(dLon, dLat) * (180 / Math.PI);
            dernierCap = (angle + 360) % 360;
          }
        }

        // --- CAMÉRA 3D COCKPIT EN TEMPS RÉEL ---
        if (suiviAutoActif && map) {
          map.easeTo({
            center: [longitude, latitude],
            zoom: 17,
            pitch: 60,
            bearing: dernierCap,
            duration: 1000, // Synchronisé avec la vitesse de rafraîchissement du GPS
            easing: (t) => t, // Mouvement linéaire pur (supprime l'effet élastique)
          });
        }

        // --- RECALCUL SI HORS ITINÉRAIRE ---
        if (
          destinationActuelle &&
          routeCoordinates.length > 1 &&
          !recalculEnCours
        ) {
          let distanceMin = Infinity;

          // On compare la position aux LIGNES de la route, pas juste aux points
          for (let i = 0; i < routeCoordinates.length - 1; i++) {
            let pt1 = routeCoordinates[i];
            let pt2 = routeCoordinates[i + 1];

            let d = distancePointSegment(
              latitude,
              longitude,
              pt1[1],
              pt1[0],
              pt2[1],
              pt2[0],
            );
            if (d < distanceMin) distanceMin = d;
          }

          // Si on s'écarte de plus de 75 mètres du vrai tracé
          if (distanceMin > 75) {
            console.log("Hors itinéraire ! Recalcul en cours...");
            recalculEnCours = true;

            tracerItineraire(
              { lat: latitude, lng: longitude },
              destinationActuelle,
            );

            // On attend 10 secondes minimum avant de s'autoriser un autre recalcul
            setTimeout(() => {
              recalculEnCours = false;
            }, 10000);
          }

          const distanceFinale = calculerDistance(
            latitude,
            longitude,
            destinationActuelle.lat,
            destinationActuelle.lng,
          );

          if (distanceFinale <= 50) {
            annoncerTexte("Vous êtes arrivé à destination. Fin du guidage.");
            arreterGuidage();
          }
        }

                derniereLat = latitude;
        derniereLon = longitude;

        // --- 🚀 NOUVEAU : MISE À JOUR INTELLIGENTE DE LA ZONE RADAR ---
        let distanceDepuisMajRadars = 999999;
        if (derniereLatMajRadars !== null && derniereLonMajRadars !== null) {
          distanceDepuisMajRadars = calculerDistance(latitude, longitude, derniereLatMajRadars, derniereLonMajRadars);
        }
        
        // Si on a bougé de plus de 5 km (5000m) depuis le dernier scan, on rafraîchit le secteur
        if (distanceDepuisMajRadars > 5000 && radarsDatabase.length > 0) {
          mettreAJourRadarsProches(latitude, longitude);
        }

        // --- CAMÉRA 3D COCKPIT EN TEMPS RÉEL ---
        if (suiviAutoActif && map) {
          map.easeTo({
            center: [longitude, latitude],
            zoom: 17,
            pitch: 60,
            bearing: dernierCap,
            duration: 900, // 🔧 RÉDUIT À 900ms : Supprime les saccades en se calant sous la seconde
            easing: (t) => t, 
          });
        }

        if (!userMarker) {
          userCarElement = document.createElement("div");
          userCarElement.style.width = "40px";
          userCarElement.style.height = "40px";
          userCarElement.style.backgroundImage = "url('voiture-removebg-preview.png')";
          userCarElement.style.backgroundSize = "contain";
          userCarElement.style.backgroundRepeat = "no-repeat";
          userCarElement.style.backgroundPosition = "center";

          userMarker = new mapboxgl.Marker({
            element: userCarElement,
            rotationAlignment: "map",
          })
            .setLngLat([longitude, latitude])
            .addTo(map);
        } else {
          userMarker.setLngLat([longitude, latitude]);
        }

        if (
          instructionsActuelles.length > 0 &&
          indexInstructionActuelle < instructionsActuelles.length
        ) {
          const inst = instructionsActuelles[indexInstructionActuelle];
          if (inst.location) {
            const distVersInst = calculerDistance(
              latitude,
              longitude,
              inst.location[1],
              inst.location[0],
            );

            if (distVersInst <= 35) {
              annoncerTexte(inst.text);
              indexInstructionActuelle++;
            }
          }
        }

        // --- 🚀 BOUCLE OPTIMISÉE DES RADARS (Utilise radarsProches) ---
        if (radarsProches.length > 0) { // <--- Changement ici
          let plusProcheDistance = 999999;
          let radarConcerne = { nom: "Aucun", vitesseLimite: "--" };

          radarsProches.forEach((radar) => { // <--- Changement ici
            const distance = calculerDistance(latitude, longitude, radar.lat, radar.lon);
            if (distance < plusProcheDistance) {
              plusProcheDistance = distance;
              radarConcerne = radar;
            }
          });

          // 🟢 MISE À JOUR DU PANNEAU : On envoie la limite ET la distance
          const limiteNum = parseInt(radarConcerne.vitesseLimite);
          if (typeof mettreAJourPanneauVitesse === "function") {
            mettreAJourPanneauVitesse(
              isNaN(limiteNum) ? null : limiteNum,
              plusProcheDistance,
            );
          }

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

            const limiteVitesse = parseInt(radarConcerne.vitesseLimite);
            let limiteToleree = limiteVitesse;

            if (toleranceActive === "5") limiteToleree += 5;
            if (toleranceActive === "10") limiteToleree += limiteVitesse * 0.1;

            if (!isNaN(limiteVitesse) && vitesseKmH > limiteToleree) {
              if (currentSpeedEl) currentSpeedEl.style.color = "#e74c3c";
              if (speedGauge) speedGauge.style.stroke = "#e74c3c";
            } else {
              if (currentSpeedEl) currentSpeedEl.style.color = "white";
              if (speedGauge) {
                if (!isNaN(limiteVitesse) && vitesseKmH >= limiteVitesse - 5) {
                  speedGauge.style.stroke = "#f1c40f";
                } else {
                  speedGauge.style.stroke = "#27ae60";
                }
              }
            }

            const maintenant = Date.now();
            if (maintenant - dernierBipTime > 2000) {
              jouerBipAlerte();
              annoncerRadarVocal(radarConcerne, distanceArrondie);
              dernierBipTime = maintenant;
            }
          } else {
            if (alertBanner) alertBanner.classList.add("hidden");
            if (currentSpeedEl) {
              currentSpeedEl.style.color = "";
              currentSpeedEl.classList.remove("clignotant");
            }
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
  const pos = userMarker.getLngLat();
  tracerItineraire({ lat: pos.lat, lng: pos.lng }, { lat: lat, lng: lng });
}

function chargerFavorisStorage() {
  const favorisStorage = JSON.parse(localStorage.getItem("favoris_gps")) || [];
  const favContainer = document.getElementById("favorites-bar");
  if (!favContainer) return;

  favorisStorage.forEach((fav) => {
    const btn = document.createElement("button");
    btn.textContent = `⭐ ${fav.nom}`;
    btn.style.margin = "5px";
    btn.onclick = () => lancerFavori(fav.lat, fav.lng);
    favContainer.appendChild(btn);
  });
}

function ajouterFavoriActuel(nomPersonnalise) {
  if (!destinationActuelle) {
    alert(
      "Veuillez d'abord calculer un itinéraire vers la destination à sauvegarder.",
    );
    return;
  }
  const favorisStorage = JSON.parse(localStorage.getItem("favoris_gps")) || [];
  favorisStorage.push({
    nom: nomPersonnalise,
    lat: destinationActuelle.lat,
    lng: destinationActuelle.lng,
  });
  localStorage.setItem("favoris_gps", JSON.stringify(favorisStorage));
  alert(
    `Favori "${nomPersonnalise}" sauvegardé avec succès ! Rechargez la page pour l'afficher.`,
  );
}

// --- 8. RECHERCHE PERSONNALISÉE MAPBOX AUTOCOMPLETE ---
const searchInput = document.getElementById("custom-search-input");
const searchResults = document.getElementById("custom-search-results");
let searchTimeout = null;

if (searchInput) {
  searchInput.addEventListener("input", function () {
    clearTimeout(searchTimeout);
    const query = this.value;

    if (query.length < 3) {
      if (searchResults) searchResults.style.display = "none";
      return;
    }

    searchTimeout = setTimeout(() => {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&country=fr&language=fr&autocomplete=true&limit=5`;

      fetch(url)
        .then((response) => response.json())
        .then((data) => {
          if (!searchResults) return;
          searchResults.innerHTML = "";
          if (data.features && data.features.length > 0) {
            searchResults.style.display = "block";

            data.features.forEach((feature) => {
              const li = document.createElement("li");
              li.textContent = feature.place_name_fr;
              li.style.padding = "12px 18px";
              li.style.borderBottom = "1px solid #f0f0f0";
              li.style.cursor = "pointer";
              li.style.fontSize = "15px";
              li.style.color = "#333";

              li.addEventListener(
                "mouseover",
                () => (li.style.backgroundColor = "#f9f9f9"),
              );
              li.addEventListener(
                "mouseout",
                () => (li.style.backgroundColor = "transparent"),
              );

              li.addEventListener("click", () => {
                if (!userMarker) {
                  alert(
                    "Veuillez d'abord lancer le GPS (Activer le GPS) pour définir votre point de départ.",
                  );
                  return;
                }
                const [lng, lat] = feature.center;
                searchInput.value = feature.place_name_fr;
                searchResults.style.display = "none";

                const pos = userMarker.getLngLat();
                tracerItineraire(
                  { lat: pos.lat, lng: pos.lng },
                  { lat: lat, lng: lng },
                );
              });

              searchResults.appendChild(li);
            });
          } else {
            searchResults.style.display = "none";
          }
        })
        .catch((err) => console.error("Erreur de recherche Mapbox :", err));
    }, 300);
  });

  document.addEventListener("click", (e) => {
    if (e.target !== searchInput && e.target !== searchResults) {
      if (searchResults) searchResults.style.display = "none";
    }
  });
}

// --- 9. CONTRÔLEUR DE MUSIQUE (MEDIA SESSION API) ---
const playPauseBtn = document.getElementById("music-play-pause");
const prevBtn = document.getElementById("music-prev");
const nextBtn = document.getElementById("music-next");

let isPlaying = false;

if (playPauseBtn) {
  playPauseBtn.addEventListener("click", () => {
    if ("mediaSession" in navigator) {
      if (navigator.mediaSession.playbackState === "playing") {
        navigator.mediaSession.playbackState = "paused";
        playPauseBtn.textContent = "▶️";
        isPlaying = false;
      } else {
        navigator.mediaSession.playbackState = "playing";
        playPauseBtn.textContent = "⏸️";
        isPlaying = true;
      }
    } else {
      isPlaying = !isPlaying;
      playPauseBtn.textContent = isPlaying ? "⏸️" : "▶️";
    }
  });
}

if (prevBtn) {
  prevBtn.addEventListener("click", () => {
    if ("mediaSession" in navigator) {
      try {
        if (navigator.mediaSession.setPositionState)
          navigator.mediaSession.setPositionState();
      } catch (e) {
        console.log("Erreur MediaSession Prev:", e);
      }
    }
  });
}

if (nextBtn) {
  nextBtn.addEventListener("click", () => {
    if ("mediaSession" in navigator) {
      try {
        console.log("Action : Morceau suivant");
      } catch (e) {
        console.log("Erreur MediaSession Next:", e);
      }
    }
  });
}

if ("mediaSession" in navigator) {
  navigator.mediaSession.setActionHandler("play", function () {
    isPlaying = true;
    if (playPauseBtn) playPauseBtn.textContent = "⏸️";
  });
  navigator.mediaSession.setActionHandler("pause", function () {
    isPlaying = false;
    if (playPauseBtn) playPauseBtn.textContent = "▶️";
  });
}

// --- GESTION DU PANNEAU DE LIMITATION DE VITESSE ---
function mettreAJourPanneauVitesse(limiteKmH, distanceMetres) {
  const panneau = document.getElementById("speed-limit-sign");
  const texteLimite = document.getElementById("speed-limit-value");
  const vitesseActuelleEl = document.getElementById("current-speed");

  const vitesseActuelle = vitesseActuelleEl
    ? parseInt(vitesseActuelleEl.textContent) || 0
    : 0;

  // 🟢 On affiche le panneau SEULEMENT si on a une limite ET qu'on est à moins de 2000m (2 km)
  if (limiteKmH && limiteKmH > 0 && distanceMetres <= 2000) {
    if (panneau) panneau.style.display = "flex";
    if (texteLimite) texteLimite.textContent = limiteKmH;

    // Alerte visuelle si on dépasse la vitesse autorisée
    if (panneau) {
      if (vitesseActuelle > limiteKmH) {
        panneau.style.borderColor = "#e74c3c"; // Rouge vif d'alerte
        panneau.style.boxShadow = "0 0 10px rgba(231, 76, 60, 0.8)";
      } else {
        panneau.style.borderColor = "#c0392b"; // Standard panneau français
        panneau.style.boxShadow = "0 2px 6px rgba(0,0,0,0.3)";
      }
    }
  } else {
    // Si on est à plus de 2 km, le danger est loin, on masque le panneau
    if (panneau) panneau.style.display = "none";
  }
}
