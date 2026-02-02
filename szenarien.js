// /szenarien.js  (v1)
// Zentrale Einsatzmeldungen für index1 (Melder-Overlay)
// - Offline-sicher (kein fetch)
// - Szenario wird über localStorage.scenarioId ausgewählt

window.SCENARIOS = {
  // ===== Beispiel 1 =====
   s1: {
    name: "Schlägerei auf Party",
    melderImage: "/fotos/Melder_Leer.png",
    pagerSound: "/Alarmton2.mp3",
    pauseAfterConfirmMs: 260,
    pagerDelayAfterOpenMs: 120,
    lineDelayMs: 340,
    lines: [
      "Alarm RTW 1-83-4 AO1499",
      "Einsatzstraße 39",
      "Schlägerei",
      "Pol. auf Anfahrt"
    ]
  },
   s2: {
    name: "Unklare Lage am Bahnhof",
    melderImage: "/fotos/Melder_Leer.png",
    pagerSound: "/Alarmton2.mp3",
    pauseAfterConfirmMs: 260,
    pagerDelayAfterOpenMs: 120,
    lineDelayMs: 340,
    lines: [
      "Alarm RTW 1-83-3 AO1859",
      "Hauptbahnhof Bahnsteig 1",
      "Unklare Lage",
      "Pol. vor Ort"
    ]
  },
  
  s3: {
    name: "Schnittverletzung in der Industriehalle",
    melderImage: "/fotos/Melder_Leer.png",    // oder besser: /melder_leer.png
    pagerSound: "/Alarmton2.mp3",
    confirmMs: 320,                         // Länge Confirm-Beep (nur Timing, Sound ist WebAudio)
    pauseAfterConfirmMs: 260,               // Pause nach Confirm
    pagerDelayAfterOpenMs: 120,             // Delay bis Pager-Ton
    lineDelayMs: 320,                       // Zeilen erscheinen langsamer
    lines: [
      "Alarm RTW 2-85-7 A22587" ,
      "Industriestrasse 23-27",
      "(Gebläsehalle/Messehalle))",
      "Schnittverletzung"
    ]
  },

  // ===== Beispiel 2 =====
  s4: {
    name: "Platzwunde ZOB",
    melderImage: "/fotos/Melder_Leer.png",
    pagerSound: "/Alarmton2.mp3",
    pauseAfterConfirmMs: 260,
    pagerDelayAfterOpenMs: 120,
    lineDelayMs: 340,
    lines: [
      "Alarm  RTW 2-83-1 A05578",
      "Hauptsraße 31-35 dortiges ZOB",
      "Platzwunde",
      "Pol. auf Anfahrt"
    ]
  },
  s5: {
    name: "Schlägerei in der Einkaufspassage",
    melderImage: "/fotos/Melder_Leer.png",
    pagerSound: "/Alarmton2.mp3",
    pauseAfterConfirmMs: 260,
    pagerDelayAfterOpenMs: 120,
    lineDelayMs: 340,
    lines: [
      "Alarm  RTW 1-885 A05789",
      "Passage 22-27 (City Galerie)",
      "Unklare Lage vermutlich Schlägerei",
      "Pol. auf Anfahrt"
    ]
  },
s6: {
    name: "Schnittverletzung im Kaufhaus",
    melderImage: "/fotos/Melder_Leer.png",
    pagerSound: "/Alarmton2.mp3",
    pauseAfterConfirmMs: 260,
    pagerDelayAfterOpenMs: 120,
    lineDelayMs: 340,
    lines: [
      "Alarm  RTW 1-84-1 A04778",
      "Grüner Weg 29-32 (Kaufahaus)",
      "Schnittverletzung nach Schlägerei",
      "Pol. auf Anfahrt"
    ]
  },
  s7: {
    name: "Schlägerei in der Regionalbahn",
    melderImage: "/fotos/Melder_Leer.png",
    pagerSound: "/Alarmton2.mp3",
    pauseAfterConfirmMs: 260,
    pagerDelayAfterOpenMs: 120,
    lineDelayMs: 340,
    lines: [
      "Alarm  RTW 1-82-3 A012879",
      "Zum Bahnhof 1 (Bahnsteig 2)",
      "Schlägerei in der Regionalbahn",
      "Bundespolizei am Ort"
    ]
  },
  s8: {
    name: "Unklare Lage in der Fußgängerzone",
    melderImage: "/fotos/Melder_Leer.png",
    pagerSound: "/Alarmton2.mp3",
    pauseAfterConfirmMs: 260,
    pagerDelayAfterOpenMs: 120,
    lineDelayMs: 340,
    lines: [
      "Alarm  RTW 1-83-1 A08778",
      "Gehweg 29-38 (Fußgängerzone höhe Alm Klause)",
      "Unklare Lage",
      "Pol. auf Anfahrt"
    ]
  },
 
  };
// Helper: aktuelles Szenario liefern (mit Fallback)
window.getActiveScenario = function(){
  const id = localStorage.getItem('scenarioId') || 's1';
  return window.SCENARIOS?.[id] || window.SCENARIOS.s1;
};
