<?php
// /metrics.php – Event-Endpoint: schreibt Patient-/Seiten-Events & Nutzungsdauer
// Erweitert um patient_daily & page_daily mit Upsert, Normalisierung & UTC-Tage
$dbFile = __DIR__ . '/metrics.db';

try {
  $db = new PDO('sqlite:' . $dbFile, null, null, [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
  ]);

  // --- Tabellen anlegen (bestehende + neue Daily-Tabellen) ---
  $db->exec("
    CREATE TABLE IF NOT EXISTS patient_stats (
      patient_id TEXT PRIMARY KEY,
      clicks INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS page_stats (
      page TEXT PRIMARY KEY,
      views INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS usage_stats (
      day TEXT PRIMARY KEY,          -- YYYY-MM-DD (UTC)
      seconds_total INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS patient_daily (
      day TEXT NOT NULL,             -- YYYY-MM-DD (UTC)
      patient_id TEXT NOT NULL,      -- nur Nummer als Text, z.B. "15"
      clicks INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, patient_id)
    );
    CREATE TABLE IF NOT EXISTS page_daily (
      day TEXT NOT NULL,             -- YYYY-MM-DD (UTC)
      page TEXT NOT NULL,            -- kanonisierter Pfad, z.B. "/index.html"
      views INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, page)
    );
  ");

  // --- Helpers ---
  $day = gmdate('Y-m-d'); // UTC-Tagesgrenze

  // Patient-ID zu Nummer normalisieren (patient17 -> 17, "17" bleibt 17)
  $normPid = function($raw) {
    $s = (string)$raw;
    $s = str_ireplace('patient','',$s);
    $s = preg_replace('~\D~','',$s);
    return $s === '' ? null : (string)intval($s,10);
  };

  // Seitenpfad kanonisieren -> immer lowercase, .html, index vereinheitlichen
  $normPage = function($raw) {
    $p = strtolower(trim((string)$raw));
    if ($p === '' || $p === '/') $p = '/index.html';
    // nur basename erlauben, wenn Pfad kam
    if (strpos($p,'/') === false) $p = '/'.$p;
    // trailing slash weg
    $p = rtrim($p,'/');
    // index.* vereinheitlichen
    if ($p === '' || $p === '/') $p = '/index.html';
    if (preg_match('~/(index|index\.htm)$~i',$p)) $p = '/index.html';
    if (!str_ends_with($p,'.html')) $p .= '.html';
    return $p;
  };

  // --- Payload lesen ---
  $raw = file_get_contents('php://input');
  $json = json_decode($raw, true);
  if (!is_array($json) || !isset($json['type'])) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['ok'=>false,'error'=>'bad payload']);
    exit;
  }

  switch ($json['type']) {
    /* ----------------------- PATIENT CLICK / VIEW ----------------------- */
    case 'patient_click':
    case 'patient_view': {
      $pidRaw = $json['patient_id'] ?? null;
      $pid = $normPid($pidRaw);
      if(!$pid){
        http_response_code(400);
        header('Content-Type: application/json');
        echo json_encode(['ok'=>false,'error'=>'missing/invalid patient_id']);
        exit;
      }

      $db->beginTransaction();
      // Gesamtsumme (wie bisher)
      $stmt = $db->prepare("
        INSERT INTO patient_stats(patient_id, clicks) VALUES(:pid, 1)
        ON CONFLICT(patient_id) DO UPDATE SET clicks = clicks + 1
      ");
      $stmt->execute([':pid'=>$pid]);

      // NEU: Tageszähler
      $stmt = $db->prepare("
        INSERT INTO patient_daily(day, patient_id, clicks) VALUES(:d, :pid, 1)
        ON CONFLICT(day, patient_id) DO UPDATE SET clicks = clicks + 1
      ");
      $stmt->execute([':d'=>$day, ':pid'=>$pid]);

      $db->commit();

      header('Content-Type: application/json');
      echo json_encode(['ok'=>true]);
      exit;
    }

    /* ----------------------------- PAGE VIEW ---------------------------- */
    case 'page_view': {
      // Erwartet z. B. 'instruktor.html' oder Pfad
      $pageIn = $json['page'] ?? ($_SERVER['REQUEST_URI'] ?? '/index.html');
      $page   = $normPage($pageIn);

      $db->beginTransaction();
      // Gesamtsumme (wie bisher)
      $stmt = $db->prepare("
        INSERT INTO page_stats(page, views) VALUES(:p, 1)
        ON CONFLICT(page) DO UPDATE SET views = views + 1
      ");
      $stmt->execute([':p'=>$page]);

      // NEU: Tageszähler
      $stmt = $db->prepare("
        INSERT INTO page_daily(day, page, views) VALUES(:d, :p, 1)
        ON CONFLICT(day, page) DO UPDATE SET views = views + 1
      ");
      $stmt->execute([':d'=>$day, ':p'=>$page]);

      $db->commit();

      header('Content-Type: application/json');
      echo json_encode(['ok'=>true]);
      exit;
    }

    /* --------------------------- SESSION END ---------------------------- */
    case 'session_end': {
      // Sekunden addieren (ggf. harte Obergrenze pro Event setzen)
      $sec = max(0, (int)($json['seconds'] ?? 0));
      if ($sec > 0) {
        // Optional: pro Event deckeln, damit Ausreißer nicht alles verzerren
        $sec = min($sec, 6 * 3600); // z.B. 6h Max. pro session_end
        $db->beginTransaction();
        $stmt = $db->prepare("
          INSERT INTO usage_stats(day, seconds_total) VALUES(:d,:s)
          ON CONFLICT(day) DO UPDATE SET seconds_total = seconds_total + :s
        ");
        $stmt->execute([':d'=>$day, ':s'=>$sec]);
        $db->commit();
      }
      header('Content-Type: application/json');
      echo json_encode(['ok'=>true]);
      exit;
    }

    /* -------------------------- SESSION START --------------------------- */
    case 'session_start': {
      header('Content-Type: application/json');
      echo json_encode(['ok'=>true]);
      exit;
    }
  }

  http_response_code(400);
  header('Content-Type: application/json');
  echo json_encode(['ok'=>false,'error'=>'unknown type']);

} catch (Throwable $e) {
  http_response_code(500);
  header('Content-Type: application/json');
  echo json_encode(['ok'=>false,'error'=>'server']);
}
