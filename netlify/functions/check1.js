export async function handler(event, context) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed",
    };
  }

let passwort;

try {
  const json = JSON.parse(event.body);
  passwort = json.passwort;
} catch(e) {
  // fallback für x-www-form-urlencoded
  const params = new URLSearchParams(event.body);
  passwort = params.get("passwort");
}

  // statisch definierte Passwörter
  let passwoerter = [
    {
      passwort: "start123",
      status: "unused",
      dauer: 12
    },
    {
      passwort: "premium456",
      status: "unused",
      dauer: 24
    },
    {
      passwort: "jahreszugang789",
      status: "unused",
      dauer: 24 * 365
    }
  ];

  let eintrag = passwoerter.find((pw) => pw.passwort === passwort);

  if (!eintrag) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ergebnis: "fehler" }),
    };
  }

  // hier KEIN status speichern (weil kein echtes Dateisystem)
  // einfach zurückgeben und im localStorage merken
  const ablauf = new Date();
  ablauf.setHours(ablauf.getHours() + eintrag.dauer);

  return {
    statusCode: 200,
    body: JSON.stringify({
      ergebnis: "ok",
      gueltigBis: ablauf.toISOString(),
    }),
  };
}
