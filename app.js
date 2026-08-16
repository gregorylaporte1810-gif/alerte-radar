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
let toleranceActive = localStorage.getItem('gps_tolerance') || '0';

let map;
let userMarker;
let radarMarkers = [];
let radarsDatabase = [];
let audioCtx;
let dernierBipTime = 0;
let routingControl = null;
let destinationActuelle = null;
let derniereAnnonceVocale = 0;
let voiceGuidanceEnabled = false;
let derniereLat = null;
let derniereLon = null;
let dernierCap = 0;
let instructionsActuelles = [];
let routeCoordinates = [];
let indexInstructionActuelle = 0;
let heureArriveeEstimee = null;
let distanceRestanteMetres = 0;
let recalculEnCours = false;
let suiviAutoActif = true; // Gère le recentrage de la carte

const carIcon = L.icon({
  iconUrl: "voiture-removebg-preview.png",
  iconSize: [35, 35],
  iconAnchor: [17, 17],
});

// --- 2. FONCTIONS D'ITINÉRAIRE & NAVIGATION ---

function afficherInfosTrajet(summary) {
  // On sauvegarde les données pour le décompte en temps réel
  distanceRestanteMetres = summary.totalDistance;
  const maintenant = new Date();
  heureArriveeEstimee = new Date(
    maintenant.getTime() + summary.totalTime * 1000,
  );

  const distanceKm = (distanceRestanteMetres / 1000).toFixed(1);
  const minutesTotales = Math.round(summary.totalTime / 60);
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
  if (navControls) navControls.style.display = "block";
}

let routePolyline = null; // Variable globale pour stocker la ligne bleue active

function tracerItineraire(start, destination) {
  destinationActuelle = destination;
  document.getElementById("favorites-bar").style.display = "none";
  document.getElementById("route-options").style.display = "none";

  if (routingControl) {
    map.removeControl(routingControl);
    routingControl = null;
  }
  if (routePolyline) {
    map.removeLayer(routePolyline);
    routePolyline = null;
  }

  // --- 1. LECTURE DES OPTIONS ---
  const sansPeage = document.getElementById("check-peage")?.checked;
  const sansAutoroute = document.getElementById("check-autoroute")?.checked;

  let exclusions = [];
  if (sansPeage) exclusions.push("toll");
  if (sansAutoroute) exclusions.push("motorway");

  // --- 2. CONFIGURATION MAPBOX SÉCURISÉE ---
  const mapboxToken =
    "pk.eyJ1IjoiZ3JlZ29yeWJvZWhtYmVsaW4iLCJhIjoiY21zdHR6b2lmMGt5bzJ3cXV2ZXpoZW14dSJ9.tsmUFMuFvJpUDalG3GY3zQ";

  const routerMapbox = L.Routing.osrmv1({
    serviceUrl: "https://api.mapbox.com/directions/v5",
    profile: "mapbox/driving",
  });

  routerMapbox.buildRouteUrl = function (waypoints, options) {
    const coords = waypoints
      .map((wp) => `${wp.latLng.lng},${wp.latLng.lat}`)
      .join(";");
    let url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?access_token=${mapboxToken}`;

    url += "&geometries=polyline&overview=full&steps=true&language=fr";

    if (exclusions.length > 0) {
      url += `&exclude=${exclusions.join(",")}`;
      url += "&alternatives=false";
    } else {
      url += "&alternatives=true";
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
    fitSelectedRoutes: false,
    addWaypoints: false,
    // On masque la ligne par défaut de Leaflet pour dessiner notre propre polyline interactive
    lineOptions: {
      styles: [{ opacity: 0, weight: 0 }],
    },
    createMarker: function (i, wp, nWps) {
      if (i === nWps - 1) {
        return L.marker(wp.latLng);
      }
      return null;
    },
  }).addTo(map);

  // --- 4. AFFICHAGE ET GESTION DES RÉSULTATS ---
  routingControl.on("routesfound", function (e) {
    const routes = e.routes;
    if (!routes || routes.length === 0) return;

    const instructionsContainer = document.getElementById(
      "instructions-container",
    );
    if (!instructionsContainer) return;

    // Fonction pour basculer dynamiquement d'une option à l'autre au clic
    function afficherRouteSelectionnee(index) {
      const activeRoute = routes[index];
      // On stocke les instructions et les coordonnées pour le guidage en temps réel
      instructionsActuelles = activeRoute.instructions || [];
      routeCoordinates = activeRoute.coordinates || [];
      indexInstructionActuelle = 1; // On commence à 1 car la 0 est déjà lue au démarrage

      // Mettre à jour le dashboard et l'ETA
      if (activeRoute.summary) {
        afficherInfosTrajet(activeRoute.summary);
      }

      // Dessiner ou redessiner la ligne bleue sur la carte pour cette option
      if (routePolyline) {
        map.removeLayer(routePolyline);
      }
      if (activeRoute.coordinates) {
        routePolyline = L.polyline(activeRoute.coordinates, {
          color: "#3498db",
          opacity: 0.85,
          weight: 7,
        }).addTo(map);
      }

      // Reconstruire entièrement la modale et les boutons de sélection
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
          const distKm = route.summary
            ? (route.summary.totalDistance / 1000).toFixed(1)
            : "0";
          const mins = route.summary
            ? Math.round(route.summary.totalTime / 60)
            : "0";

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

          // Au clic, on actualise la carte, l'ETA et la feuille de route pour cette option
          btn.onclick = () => {
            afficherRouteSelectionnee(idx);
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

      const instructions = activeRoute.instructions || [];
      instructions.forEach((instruction) => {
        const div = document.createElement("div");
        div.style.padding = "8px 0";
        div.style.borderBottom = "1px solid #eee";
        const texteBrut = instruction.text || "Continuer";
        const texteFr = traduireInstruction(texteBrut);
        const distM = instruction.distance
          ? Math.round(instruction.distance)
          : 0;
        div.innerHTML = `➡️ ${texteFr} <small style="color:gray;">(${distM}m)</small>`;
        instructionsContainer.appendChild(div);
      });
    }

    // Afficher l'option 1 par défaut au premier calcul
    afficherRouteSelectionnee(0);

    // Annonce vocale initiale de la toute première consigne
    const firstInstructions = routes[0].instructions;
    if (
      firstInstructions &&
      firstInstructions.length > 0 &&
      firstInstructions[0].text
    ) {
      const premiereConsigneFr = traduireInstruction(firstInstructions[0].text);
      annoncerTexte("Itinéraire calculé. " + premiereConsigneFr);
      instructionsActuelles = firstInstructions;
      routeCoordinates = routes[0].coordinates || [];
      indexInstructionActuelle = 1; // La prochaine sera la numéro 1
    }
  });

  routingControl.on("routingerror", function (e) {
    console.error("Erreur de guidage :", e);
  });
}

function arreterGuidage() {
  if (routingControl) {
    map.removeControl(routingControl);
    routingControl = null;
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

  // --- CHARGEMENT DES RADARS DEPUIS LA NOUVELLE API ---
  fetch(API_URL)
    .then((response) => response.json())
    .then((data) => {
      radarsDatabase = data
        .map((item) => {
          return {
            id: item.id,
            type: item.type,
            dateMiseEnService: item.date_mise_en_service,
            vitesseLimite:
              item.vitesse_limite === "NA" ? "NA" : item.vitesse_limite,
            lat: parseFloat(item.lat),
            lon: parseFloat(item.lon),
            nom: `${item.type} (${item.id})`,
          };
        })
        .filter((radar) => !isNaN(radar.lat) && !isNaN(radar.lon));

      console.log(
        "Radars chargés depuis l'API locale SQL :",
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
    .catch((error) => console.error("Erreur connexion API radars :", error));
  document.getElementById("loading-radars").style.display = "none";
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
      if (document.body.classList.contains("dark-mode")) {
        localStorage.setItem("gps_theme", "dark");
        btnTheme.textContent = "☀️";
      } else {
        localStorage.setItem("gps_theme", "light");
        btnTheme.textContent = "🌙";
      }
    });
  }

  const selectTolerance = document.getElementById("tolerance-select");
  if (selectTolerance) {
    selectTolerance.value = toleranceActive;
    selectTolerance.addEventListener("change", (e) => {
      toleranceActive = e.target.value;
      localStorage.setItem('gps_tolerance', toleranceActive);
    });
  }

  // --- GESTION DU RECENTRAGE MANUEL ---
  map.on("dragstart", function () {
    suiviAutoActif = false; // On désactive le suivi si l'utilisateur bouge la carte
    const btnRecentrer = document.getElementById("btn-recentrer");
    if (btnRecentrer) btnRecentrer.style.display = "block";
  });

  const btnRecentrer = document.getElementById("btn-recentrer");
  if (btnRecentrer) {
    btnRecentrer.addEventListener("click", () => {
      suiviAutoActif = true; // On réactive le suivi
      btnRecentrer.style.display = "none";
      if (derniereLat !== null && derniereLon !== null) {
        map.setView([derniereLat, derniereLon], 17, { animate: true });
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
  // Gestion du clic sur le bouton Voix ON/OFF
  const btnVoiceToggle = document.getElementById("btn-voice-toggle");
  if (btnVoiceToggle) {
    btnVoiceToggle.addEventListener("click", () => {
      voiceGuidanceEnabled = !voiceGuidanceEnabled; // On inverse l'état (vrai/faux)
      if (voiceGuidanceEnabled) {
        btnVoiceToggle.textContent = "🔊 Voix : ON";
        btnVoiceToggle.style.backgroundColor = "#27ae60"; // Passe en vert
        annoncerTexte("Guidage vocal activé.");
      } else {
        btnVoiceToggle.textContent = "🔇 Voix : OFF";
        btnVoiceToggle.style.backgroundColor = "#e74c3c"; // Passe en rouge
        if ("speechSynthesis" in window) {
          window.speechSynthesis.cancel(); // Coupe proprement la parole
        }
      }
    });
  }
  // Recalculer l'itinéraire automatiquement si on coche/décoche les options de route
  const checkPeage = document.getElementById("check-peage");
  const checkAutoroute = document.getElementById("check-autoroute");

  function actualiserFiltresRoute() {
    if (destinationActuelle && userMarker) {
      tracerItineraire(userMarker.getLatLng(), destinationActuelle);
    }
  }

  if (checkPeage) {
    checkPeage.addEventListener("change", actualiserFiltresRoute);
  }
  if (checkAutoroute) {
    checkAutoroute.addEventListener("change", actualiserFiltresRoute);
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

function annoncerTexte(texte) {
  // Si la voix est désactivée ou que le navigateur n'gère pas la synthèse, on s'arrête là
  if (!voiceGuidanceEnabled || !("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel(); // Coupe la phrase précédente s'il y en a une en cours
  const msg = new SpeechSynthesisUtterance(texte);
  msg.lang = "fr-FR";
  msg.rate = 1.1; // Vitesse de lecture un peu plus rapide
  window.speechSynthesis.speak(msg);
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

        if (currentSpeedEl) {
          currentSpeedEl.textContent = vitesseKmH;
        }

        // Animation du HUD Circulaire (circonférence = 314)
        const speedGauge = document.getElementById("speed-gauge");
        if (speedGauge) {
          const maxSpeed = 180; 
          let fillPercentage = vitesseKmH / maxSpeed;
          if (fillPercentage > 1) fillPercentage = 1;
          
          const offset = 314 - (314 * fillPercentage);
          speedGauge.style.strokeDashoffset = offset;
        }

        if (suiviAutoActif) {
          map.setView([latitude, longitude], 17, { animate: true });

          // Calcul mathématique du cap en fonction du déplacement réel
          if (derniereLat !== null && derniereLon !== null) {
            const dLat = latitude - derniereLat;
            const dLon = longitude - derniereLon;
            const distanceParcourue = calculerDistance(
              derniereLat,
              derniereLon,
              latitude,
              longitude,
            );

            // --- 1. DÉCOMPTE DU TEMPS ET DE LA DISTANCE ---
            if (distanceRestanteMetres > 0 && distanceParcourue > 0) {
              distanceRestanteMetres -= distanceParcourue; // On soustrait les mètres roulés
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

                // Mise à jour visuelle en direct
                const etaValueEl = document.getElementById("eta-value");
                if (etaValueEl) {
                  etaValueEl.textContent = `${tempsTexte} (${distKm} km)`;
                }
              }
            }

            // --- 2. CALCUL DE L'ORIENTATION (CAP) ---
            if (distanceParcourue > 0.5) {
              // Uniquement si on a vraiment bougé d'un demi-mètre
              let angle = Math.atan2(dLon, dLat) * (180 / Math.PI);
              dernierCap = (angle + 360) % 360;
            }
          }

          // --- 3. RECALCUL AUTOMATIQUE SI HORS ITINÉRAIRE ---
          if (
            destinationActuelle &&
            typeof routeCoordinates !== "undefined" &&
            routeCoordinates.length > 0 &&
            !recalculEnCours
          ) {
            let distanceMin = Infinity;
            // On vérifie la distance de la voiture avec la ligne bleue (un point sur 5 pour la performance)
            for (let i = 0; i < routeCoordinates.length; i += 5) {
              let d = calculerDistance(
                latitude,
                longitude,
                routeCoordinates[i].lat,
                routeCoordinates[i].lng,
              );
              if (d < distanceMin) distanceMin = d;
            }

            // Si la voiture s'éloigne de plus de 150 mètres des points du tracé -> Recalcul !
            if (distanceMin > 150) {
              console.log("Hors itinéraire ! Recalcul en cours en silence...");
              recalculEnCours = true;

              tracerItineraire(
                L.latLng(latitude, longitude),
                destinationActuelle,
              );

              // On bloque les autres recalculs pendant 10 secondes pour laisser le temps au réseau
              setTimeout(() => {
                recalculEnCours = false;
              }, 10000);
            }
            // --- 4. ARRÊT AUTOMATIQUE À L'ARRIVÉE ---
            if (destinationActuelle && !recalculEnCours) {
              const distanceFinale = calculerDistance(
                latitude,
                longitude,
                destinationActuelle.lat,
                destinationActuelle.lng,
              );

              // Si on est à 50 mètres ou moins du point d'arrivée
              if (distanceFinale <= 50) {
                console.log("Arrivée à destination ! Coupure du GPS.");
                annoncerTexte(
                  "Vous êtes arrivé à destination. Fin du guidage.",
                );
                arreterGuidage();

                destinationActuelle = null;
              }
            }
          }

          // On mémorise la position pour le prochain calcul
          derniereLat = latitude;
          derniereLon = longitude;

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
            // On applique l'angle calculé en direct pendant que tu roules
            userMarker._icon.style.transform = `${baseTransform} rotateZ(${dernierCap}deg)`;
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

          // --- GUIDAGE VOCAL CONTINU EN TEMPS RÉEL ---
          if (
            instructionsActuelles.length > 0 &&
            indexInstructionActuelle < instructionsActuelles.length
          ) {
            const inst = instructionsActuelles[indexInstructionActuelle];
            const coordIndex = inst.index; // Position exacte du virage sur la ligne

            if (routeCoordinates && routeCoordinates[coordIndex]) {
              const targetPoint = routeCoordinates[coordIndex];
              // On calcule la distance entre la voiture et le prochain virage
              const distVersInstruction = calculerDistance(
                latitude,
                longitude,
                targetPoint.lat,
                targetPoint.lng,
              );

              // Si la voiture arrive à moins de 35 mètres de l'instruction
              if (distVersInstruction <= 35) {
                const texteFr = traduireInstruction(inst.text);
                annoncerTexte(texteFr);
                indexInstructionActuelle++; // On passe à l'instruction suivante
              }
            }
          }

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

// --- NOUVEAU : ALERTE DE SURVITESSE ---
            const limiteVitesse = parseInt(radarConcerne.vitesseLimite);
            let limiteToleree = limiteVitesse;

            // Calcul de la marge
            if (toleranceActive === '5') limiteToleree += 5;
            if (toleranceActive === '10') limiteToleree += (limiteVitesse * 0.10);

            if (!isNaN(limiteVitesse) && vitesseKmH > limiteToleree) {
              // Survitesse détectée
              if (currentSpeedEl) currentSpeedEl.style.color = "#e74c3c"; // Texte en rouge
              if (speedGauge) speedGauge.style.stroke = "#e74c3c"; // Jauge en rouge écarlate
            } else {
              // Vitesse normale
              if (currentSpeedEl) currentSpeedEl.style.color = "white";
              if (speedGauge) {
                // Si on est à moins de 5 km/h de la limite, jauge jaune d'avertissement, sinon verte
                if (!isNaN(limiteVitesse) && vitesseKmH >= limiteVitesse - 5) {
                  speedGauge.style.stroke = "#f1c40f"; // Jaune
                } else {
                  speedGauge.style.stroke = "#27ae60"; // Vert
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
  const destination = { lat: lat, lng: lng };
  tracerItineraire(userMarker.getLatLng(), destination);
}

function traduireInstruction(texte) {
  let t = texte;
  t = t.replace(/Head north/gi, "Cap au nord");
  t = t.replace(/Head south/gi, "Cap au sud");
  t = t.replace(/Head east/gi, "Cap à l'est");
  t = t.replace(/Head west/gi, "Cap à l'ouest");
  t = t.replace(/Turn sharp right/gi, "Tournez franchement à droite");
  t = t.replace(/Turn sharp left/gi, "Tournez franchement à gauche");
  t = t.replace(/Turn slight right/gi, "Légère courbe à droite");
  t = t.replace(/Turn slight left/gi, "Légère courbe à gauche");
  t = t.replace(/Turn right/gi, "Tournez à droite");
  t = t.replace(/Turn left/gi, "Tournez à gauche");
  t = t.replace(/Make a slight right/gi, "Faites un léger virage à droite");
  t = t.replace(/Make a slight left/gi, "Faites un léger virage à gauche");
  t = t.replace(
    /Take the ramp on the right/gi,
    "Prenez la bretelle sur la droite",
  );
  t = t.replace(
    /Take the ramp on the left/gi,
    "Prenez la bretelle sur la gauche",
  );
  t = t.replace(/Take the ramp/gi, "Prenez la bretelle");
  t = t.replace(/Take the exit/gi, "Prenez la sortie");
  t = t.replace(/Merge onto/gi, "Rejoignez");
  t = t.replace(/Merge left/gi, "Serrez à gauche");
  t = t.replace(/Merge right/gi, "Serrez à droite");
  t = t.replace(/Continue straight/gi, "Continuez tout droit");
  t = t.replace(/Keep right/gi, "Restez à droite");
  t = t.replace(/Keep left/gi, "Restez à gauche");
  t = t.replace(
    /Enter the traffic circle and take the 1st exit/gi,
    "Entrez dans le rond-point et prenez la 1ère sortie",
  );
  t = t.replace(
    /Enter the traffic circle and take the 2nd exit/gi,
    "Entrez dans le rond-point et prenez la 2ème sortie",
  );
  t = t.replace(
    /Enter the traffic circle and take the 3rd exit/gi,
    "Entrez dans le rond-point et prenez la 3ème sortie",
  );
  t = t.replace(
    /Enter the traffic circle and take the 4th exit/gi,
    "Entrez dans le rond-point et prenez la 4ème sortie",
  );
  t = t.replace(/Enter the traffic circle/gi, "Entrez dans le rond-point");
  t = t.replace(/At the traffic circle/gi, "Au rond-point");
  t = t.replace(/At the end of the road/gi, "Au bout de la route");
  t = t.replace(/onto/gi, "sur");
  t = t.replace(/towards/gi, "vers");
  t = t.replace(
    /You have arrived at your destination/gi,
    "Arrivée à destination",
  );
  return t;
}

// --- 8. GESTION DES FAVORIS (LOCALSTORAGE) ---
function chargerFavorisStorage() {
  const favorisStorage = JSON.parse(localStorage.getItem("favoris_gps")) || [];
  const favContainer = document.getElementById("favorites-bar");
  if (!favContainer) return;

  favorisStorage.forEach((fav) => {
    const btn = document.createElement("button");
    btn.textContent = `⭐ ${fav.nom}`;
    btn.style.margin = "5px"; // À ajuster selon ton CSS existant
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

// --- NOUVELLE BARRE DE RECHERCHE PERSONNALISÉE (MAPBOX) ---
const searchInput = document.getElementById("custom-search-input");
const searchResults = document.getElementById("custom-search-results");
let searchTimeout = null;

if (searchInput) {
  searchInput.addEventListener("input", function () {
    clearTimeout(searchTimeout); // Évite de faire une requête à chaque lettre tapée
    const query = this.value;

    if (query.length < 3) {
      searchResults.style.display = "none";
      return;
    }

    // On attend 300ms après la dernière frappe pour lancer la recherche
    searchTimeout = setTimeout(() => {
      // On réutilise ton token Mapbox existant
      const mapboxToken =
        "pk.eyJ1IjoiZ3JlZ29yeWJvZWhtYmVsaW4iLCJhIjoiY21zdHR6b2lmMGt5bzJ3cXV2ZXpoZW14dSJ9.tsmUFMuFvJpUDalG3GY3zQ";

      // Appel à l'API Mapbox (restreint à la France pour plus de précision)
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${mapboxToken}&country=fr&language=fr&autocomplete=true&limit=5`;

      fetch(url)
        .then((response) => response.json())
        .then((data) => {
          searchResults.innerHTML = "";
          if (data.features && data.features.length > 0) {
            searchResults.style.display = "block";

            data.features.forEach((feature) => {
              const li = document.createElement("li");
              li.textContent = feature.place_name_fr; // Adresse complète formatée
              li.style.padding = "12px 18px";
              li.style.borderBottom = "1px solid #f0f0f0";
              li.style.cursor = "pointer";
              li.style.fontSize = "15px";
              li.style.color = "#333";

              // Effet de survol
              li.addEventListener(
                "mouseover",
                () => (li.style.backgroundColor = "#f9f9f9"),
              );
              li.addEventListener(
                "mouseout",
                () => (li.style.backgroundColor = "transparent"),
              );

              // Clic sur une adresse
              li.addEventListener("click", () => {
                if (!userMarker) {
                  alert(
                    "Veuillez d'abord lancer le GPS (Activer le GPS) pour définir votre point de départ.",
                  );
                  return;
                }
                const [lng, lat] = feature.center; // Mapbox renvoie [Longitude, Latitude]
                searchInput.value = feature.place_name_fr; // Remplit la barre avec l'adresse choisie
                searchResults.style.display = "none"; // Cache la liste

                // Lancement de l'itinéraire
                tracerItineraire(userMarker.getLatLng(), {
                  lat: lat,
                  lng: lng,
                });
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

  // Fermer la liste déroulante si on clique n'importe où ailleurs sur la carte
  document.addEventListener("click", (e) => {
    if (e.target !== searchInput && e.target !== searchResults) {
      searchResults.style.display = "none";
    }
  });
}
