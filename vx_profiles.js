// =============================
// Eskalationsprofile
// =============================
window.VX_PROFILES = {

  blutung_dekomp: {
    titel: "Innere Blutung",
    grund: "Zunehmender RR Abfall mit Tachykardie aufgrund innerer Blutung.",
    neueKategorie: "rot",
    werte: { af: 32, puls: 140 }
  },

  sht_progredient: {
    titel: "Progrediente SHT Verschlechterung",
    grund: "Zunehmende Bewusstseinsminderung bei SHT.",
    neueKategorie: "rot",
    werte: { af: 8, puls: 45 }
  },

  tension_pneu: {
    titel: "Spannungspneumothorax",
    grund: "Akute Atemnot mit Kreislaufinstabilität.",
    neueKategorie: "rot",
    werte: { af: 35, puls: 150 }
  },

  sekundäre_blutung: {
    titel: "Sekundäre Nachblutung",
    grund: "Wieder einsetzende starke Blutung mit Kreislaufreaktion.",
    neueKategorie: "rot",
    werte: { af: 28, puls: 135 }
  }

};

// =============================
// Mapping Patient → erlaubte Profile
// =============================
window.VX_MAP = {

  4: ["sekundäre_blutung"],          // Handgelenk → Nachblutung
  6: ["blutung_dekomp"],             // aktuell grün → wird rot
  9: ["blutung_dekomp"],
  10: ["sht_progredient"],
  12: ["sekundäre_blutung"],
  14: ["blutung_dekomp"],
  16: ["sht_progredient"],
  19: ["sekundäre_blutung"],
  20: ["blutung_dekomp"],
  21: ["sht_progredient"],
  24: ["blutung_dekomp"],
  30: ["sekundäre_blutung"],
  33: ["sekundäre_blutung"],
  34: ["sht_progredient"],
  37: ["sht_progredient"]

};