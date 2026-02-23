// =============================
// Eskalationsprofile und Zufallslogik
// Version 4
// =============================

(function(){
  "use strict";

  // =============================
  // Profile
  // =============================
  window.VX_PROFILES = {
  "blutung_dekomp": {
    "titel": "Innere Blutung",
    "grund": "Zunehmender RR Abfall mit Tachykardie aufgrund innerer Blutung.",
    "neueKategorie": "rot",
    "werte": {
      "af": 32,
      "puls": 140,
      "rr": "80/50"
    }
  },
  "sht_progredient": {
    "titel": "SHT Verschlechterung",
    "grund": "Zunehmende Bewusstseinsminderung bei SHT.",
    "neueKategorie": "rot",
    "werte": {
      "af": 8,
      "puls": 45,
      "rr": "90/55"
    }
  },
  "tension_pneu": {
    "titel": "Spannungspneumothorax",
    "grund": "Akute Atemnot mit Kreislaufinstabilität.",
    "neueKategorie": "rot",
    "werte": {
      "af": 35,
      "puls": 150,
      "rr": "90/60"
    }
  },
  "sekundäre_blutung": {
    "titel": "Sekundäre Nachblutung",
    "grund": "Kreislaufdekompensation durch Blutverlust.",
    "neueKategorie": "rot",
    "werte": {
      "af": 28,
      "puls": 135,
      "rr": "80/50"
    }
  },
  "resp_insuffizienz": {
    "titel": "Respiratorische Verschlechterung",
    "grund": "Zunehmende Dyspnoe mit AF Anstieg und Tachykardie.",
    "neueKategorie": "rot",
    "werte": {
      "af": 34,
      "puls": 130,
      "rr": "95/60"
    }
  },
  "schock": {
    "titel": "Schock",
    "grund": "Unklare Kreislaufinstabilität.",
    "neueKategorie": "rot",
    "werte": {
      "af": 30,
      "puls": 140,
      "rr": "80/50"
    }
  },
  "postiktal_atemweg": {
    "titel": "Postiktale Phase",
    "grund": "Nach Krampf postiktal, erhöhtes Aspirationsrisiko und Atemwegsprobleme.",
    "neueKategorie": "rot",
    "werte": {
      "af": 14,
      "puls": 115,
      "rr": "95/60"
    }
  },
  "aspiration": {
    "titel": "Aspiration",
    "grund": "Plötzliche Atemnot nach Aspiration, rasche Verschlechterung möglich.",
    "neueKategorie": "rot",
    "werte": {
      "af": 40,
      "puls": 135,
      "rr": "95/60"
    }
  },
  "kreislauf_instabil": {
    "titel": "Kreislaufinstabilität",
    "grund": "Schwindel, Tachykardie, zunehmende Schwäche.",
    "neueKategorie": "gelb",
    "werte": {
      "af": 24,
      "puls": 115,
      "rr": "100/65"
    }
  },
  "schmerz_schock": {
    "titel": "Schmerzreaktion",
    "grund": "Zunehmende Schmerzen mit Stressreaktion und Tachykardie.",
    "neueKategorie": "gelb",
    "werte": {
      "af": 22,
      "puls": 110,
      "rr": "110/70"
    }
  },
  "hyperventilation": {
    "titel": "Hyperventilation",
    "grund": "Angst, Parästhesien, schnelle Atmung, subjektive Atemnot.",
    "neueKategorie": "gelb",
    "werte": {
      "af": 30,
      "puls": 120,
      "rr": "130/80"
    }
  },
  "beginn_ana": {
    "titel": "Beginnende Anaphylaxie",
    "grund": "Urtikaria, Unruhe, beginnende Dyspnoe.",
    "neueKategorie": "gelb",
    "werte": {
      "af": 26,
      "puls": 118,
      "rr": "110/70"
    }
  },
  "unterkuehlung": {
    "titel": "Unterkühlung",
    "grund": "Kältezittern, verlangsamte Reaktionen, zunehmende Schwäche.",
    "neueKategorie": "gelb",
    "werte": {
      "af": 18,
      "puls": 105,
      "rr": "95/60"
    }
  },
  "dehydratation": {
    "titel": "Dehydratation",
    "grund": "Flüssigkeitsmangel, Tachykardie, Kreislaufschwäche.",
    "neueKategorie": "gelb",
    "werte": {
      "af": 20,
      "puls": 112,
      "rr": "100/65"
    }
  },
  "rot_dekomp1": {
    "titel": "Progrediente Kreislaufdekompensation",
    "grund": "Verschlechterung trotz Erstversorgung, zunehmende Tachykardie, flache Atmung.",
    "neueKategorie": "rot",
    "werte": {
      "af": 28,
      "puls": 150,
      "rr": "95/60"
    }
  },
  "rot_dekomp2": {
    "titel": "Respiratorische Erschöpfung",
    "grund": "Zunehmende Erschöpfung, AF sinkt, Puls steigt, Patient wird blass.",
    "neueKategorie": "rot",
    "werte": {
      "af": 10,
      "puls": 130,
      "rr": "95/60"
    }
  },
  "reanimation_erfolglos": {
    "titel": "Kreislaufstillstand",
    "grund": "Patient ohne Vitalzeichen trotz Maßnahmen.",
    "neueKategorie": "schwarz",
    "werte": {
      "af": 0,
      "puls": 0,
      "rr": "0/0"
    }
  },
  "massive_blutung_exsang": {
    "titel": "Exsanguination",
    "grund": "Massiver Blutverlust führt zum Kreislaufstillstand.",
    "neueKategorie": "schwarz",
    "werte": {
      "af": 0,
      "puls": 0,
      "rr": "0/0"
    }
  },
  "hirndruck_kollaps": {
    "titel": "Hirndruckbedingter Kollaps",
    "grund": "SHT mit rascher neurologischer Verschlechterung bis Atemstillstand.",
    "neueKategorie": "schwarz",
    "werte": {
      "af": 0,
      "puls": 0,
      "rr": "0/0"
    }
  },
  "hypoxie_stillstand": {
    "titel": "Hypoxischer Stillstand",
    "grund": "Schwere Hypoxie führt zum Atem und Kreislaufstillstand.",
    "neueKategorie": "schwarz",
    "werte": {
      "af": 0,
      "puls": 0,
      "rr": "0/0"
    }
  },
  "tamponade_stillstand": {
    "titel": "Herzbeuteltamponade",
    "grund": "Kreislaufstillstand durch Tamponade bei Thoraxverletzung.",
    "neueKategorie": "schwarz",
    "werte": {
      "af": 0,
      "puls": 0,
      "rr": "0/0"
    }
  },
  "arrhythmie_stillstand": {
    "titel": "Maligne Rhythmusstörung",
    "grund": "Kammerflimmern, Patient wird bewusstlos, keine Vitalzeichen.",
    "neueKategorie": "schwarz",
    "werte": {
      "af": 0,
      "puls": 0,
      "rr": "0/0"
    }
  }
};


  // =============================
  // Mapping Patient zu erlaubte Profile
  // Eintrag erlaubt Strings oder Objekte {id, w}
  // =============================
  window.VX_MAP = {
  1: [ { "id": "rot_dekomp1", "w": 3 }, { "id": "rot_dekomp2", "w": 2 }, { "id": "massive_blutung_exsang", "w": 1 } ],
  2: [ { "id": "rot_dekomp1", "w": 3 }, { "id": "rot_dekomp2", "w": 2 }, { "id": "massive_blutung_exsang", "w": 2 }, { "id": "reanimation_erfolglos", "w": 1 } ],
  3: [],
  4: [],
  5: [ { "id": "schock", "w": 2 }, { "id": "rot_dekomp1", "w": 3 }, { "id": "rot_dekomp2", "w": 2 }, { "id": "massive_blutung_exsang", "w": 1 } ],
  6: [ { "id": "dehydratation", "w": 2 }, { "id": "hyperventilation", "w": 2 }, { "id": "kreislauf_instabil", "w": 2 } ],
  7: [ { "id": "sht_progredient", "w": 2 }, { "id": "hirndruck_kollaps", "w": 2 }, { "id": "hypoxie_stillstand", "w": 1 } ],
  8: [ { "id": "rot_dekomp1", "w": 3 }, { "id": "rot_dekomp2", "w": 2 }, { "id": "massive_blutung_exsang", "w": 2 }, { "id": "reanimation_erfolglos", "w": 1 } ],
  9: [],
  10: [ { "id": "sht_progredient", "w": 3 }, { "id": "postiktal_atemweg", "w": 2 } ],
  11: [ { "id": "hypoxie_stillstand", "w": 2 }, { "id": "reanimation_erfolglos", "w": 1 }, { "id": "arrhythmie_stillstand", "w": 1 } ],
  12: [ { "id": "sekundäre_blutung", "w": 3 }, { "id": "blutung_dekomp", "w": 1 } ],
  13: [ { "id": "dehydratation", "w": 2 }, { "id": "hyperventilation", "w": 2 }, { "id": "kreislauf_instabil", "w": 2 } ],
  14: [],
  15: [ { "id": "rot_dekomp1", "w": 2 }, { "id": "massive_blutung_exsang", "w": 2 }, { "id": "reanimation_erfolglos", "w": 1 } ],
  16: [ { "id": "sht_progredient", "w": 2 }, { "id": "postiktal_atemweg", "w": 1 } ],
  17: [],
  18: [ { "id": "hyperventilation", "w": 3 }, { "id": "dehydratation", "w": 1 } ],
  19: [ { "id": "sekundäre_blutung", "w": 3 }, { "id": "schock", "w": 1 } ],
  20: [ { "id": "blutung_dekomp", "w": 2 }, { "id": "schock", "w": 2 } ],
  21: [ { "id": "sht_progredient", "w": 3 }, { "id": "postiktal_atemweg", "w": 2 } ],
  22: [ { "id": "hypoxie_stillstand", "w": 1 }, { "id": "arrhythmie_stillstand", "w": 2 }, { "id": "reanimation_erfolglos", "w": 1 } ],
  23: [ { "id": "dehydratation", "w": 2 }, { "id": "hyperventilation", "w": 2 }, { "id": "kreislauf_instabil", "w": 2 } ],
  24: [ { "id": "blutung_dekomp", "w": 2 }, { "id": "schock", "w": 2 } ],
  25: [ { "id": "rot_dekomp1", "w": 3 }, { "id": "massive_blutung_exsang", "w": 2 }, { "id": "reanimation_erfolglos", "w": 1 } ],
  26: [],
  27: [ { "id": "hyperventilation", "w": 3 }, { "id": "dehydratation", "w": 1 } ],
  28: [ { "id": "dehydratation", "w": 2 }, { "id": "hyperventilation", "w": 2 }, { "id": "kreislauf_instabil", "w": 2 } ],
  29: [ { "id": "hirndruck_kollaps", "w": 2 }, { "id": "hypoxie_stillstand", "w": 1 }, { "id": "reanimation_erfolglos", "w": 1 } ],
  30: [],
  31: [ { "id": "rot_dekomp1", "w": 2 }, { "id": "rot_dekomp2", "w": 2 }, { "id": "massive_blutung_exsang", "w": 1 }, { "id": "reanimation_erfolglos", "w": 1 } ],
  32: [ { "id": "dehydratation", "w": 2 }, { "id": "hyperventilation", "w": 2 }, { "id": "kreislauf_instabil", "w": 2 } ],
  33: [ { "id": "sekundäre_blutung", "w": 3 }, { "id": "schock", "w": 1 } ],
  34: [ { "id": "sht_progredient", "w": 3 }, { "id": "postiktal_atemweg", "w": 2 } ],
  35: [ { "id": "dehydratation", "w": 2 }, { "id": "hyperventilation", "w": 2 }, { "id": "kreislauf_instabil", "w": 2 } ],
  36: [],
  37: [ { "id": "sht_progredient", "w": 2 }, { "id": "postiktal_atemweg", "w": 2 } ],
  38: [ { "id": "sht_progredient", "w": 2 }, { "id": "hirndruck_kollaps", "w": 2 }, { "id": "hypoxie_stillstand", "w": 1 } ],
  39: [],
  40: [ { "id": "dehydratation", "w": 2 }, { "id": "hyperventilation", "w": 2 }, { "id": "kreislauf_instabil", "w": 2 } ],
};

  // =============================
  // Utils
  // =============================
  function normalizeEntry(entry){
    if(!entry) return [];
    if(Array.isArray(entry)) {
      return entry.map(function(x){
        if(typeof x === "string") return { id: x, w: 1 };
        if(x && typeof x === "object" && x.id) return { id: x.id, w: (typeof x.w === "number" ? x.w : 1) };
        return null;
      }).filter(Boolean);
    }
    return [];
  }

  function pickWeighted(list){
    var items = normalizeEntry(list);
    if(!items.length) return null;

    var total = 0;
    for(var i=0;i<items.length;i++) total += Math.max(0, items[i].w || 0);
    if(total <= 0) return items[0].id;

    var r = Math.random() * total;
    var acc = 0;
    for(var j=0;j<items.length;j++){
      acc += Math.max(0, items[j].w || 0);
      if(r <= acc) return items[j].id;
    }
    return items[items.length-1].id;
  }

  window.VX_PICK_PROFILE = function(patientId){
    var entry = window.VX_MAP ? window.VX_MAP[patientId] : null;
    var profileId = pickWeighted(entry);
    if(!profileId) return null;

    var p = window.VX_PROFILES ? window.VX_PROFILES[profileId] : null;
    if(!p) return null;

    return {
      id: profileId,
      titel: p.titel,
      grund: p.grund,
      neueKategorie: p.neueKategorie,
      werte: p.werte
    };
  };

})();
