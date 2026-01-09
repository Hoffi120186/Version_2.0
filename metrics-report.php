<?php
// metrics-report.php – vollständiger Report mit Zeiträumen, Klicks/Views/Nutzung
declare(strict_types=1);

$db = new PDO('sqlite:' . __DIR__ . '/metrics.db', null, null, [
  PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
  PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);

/* --- Helpers --- */
function hasTable(PDO $db, string $name): bool {
  $q = $db->prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=? LIMIT 1");
  $q->execute([$name]); return (bool)$q->fetchColumn();
}
function fmt_hms(int $s): string { $h=intdiv($s,3600); $m=intdiv($s%3600,60); $x=$s%60; return sprintf('%02d:%02d:%02d',$h,$m,$x); }
function n($v){ return number_format((int)$v,0,',','.'); }

/* --- Zeitraum bestimmen --- */
$today = (new DateTime('today', new DateTimeZone('UTC')))->format('Y-m-d');
$start = $_GET['start'] ?? '';
$end   = $_GET['end']   ?? '';
if (isset($_GET['preset'])) {
  $now = new DateTime('today', new DateTimeZone('UTC'));
  switch ($_GET['preset']) {
    case 'today': $start=$end=$now->format('Y-m-d'); break;
    case '7d':    $end=$now->format('Y-m-d'); $start=$now->modify('-6 days')->format('Y-m-d'); break;
    case '30d':   $end=$now->format('Y-m-d'); $start=$now->modify('-29 days')->format('Y-m-d'); break;
    case 'year':  $start=(new DateTime('first day of january', new DateTimeZone('UTC')))->format('Y-m-d'); $end=$today; break;
  }
}
if (!$start) $start = (new DateTime('first day of january', new DateTimeZone('UTC')))->format('Y-m-d');
if (!$end)   $end   = $today;

/* ==========================================================
   PATIENTEN (Tagesdaten + Fallback auf Gesamtsummen)
   ========================================================== */
$patients_hint = '';
$top_patients = [];

if (hasTable($db,'patient_daily')) {
  $q = $db->prepare("
    SELECT CAST(REPLACE(patient_id,'patient','') AS INT) AS pid, SUM(clicks) AS clicks
    FROM patient_daily
    WHERE day BETWEEN :s AND :e
    GROUP BY pid
    HAVING clicks > 0
    ORDER BY clicks DESC, pid ASC
  ");
  $q->execute([':s'=>$start, ':e'=>$end]);
  $top_patients = $q->fetchAll();
  if (!$top_patients) {
    $patients_hint = 'Hinweis: Keine Tagesdaten im gewählten Zeitraum – zeige kumulierte Gesamtsummen.';
    $top_patients = $db->query("
      SELECT CAST(REPLACE(patient_id,'patient','') AS INT) AS pid, SUM(clicks) AS clicks
      FROM patient_stats
      GROUP BY pid
      HAVING SUM(clicks)>0
      ORDER BY clicks DESC, pid ASC
    ")->fetchAll();
  }
} else {
  $patients_hint = 'Hinweis: Tabelle „patient_daily“ fehlt – zeige kumulierte Gesamtsummen.';
  $top_patients = $db->query("
    SELECT CAST(REPLACE(patient_id,'patient','') AS INT) AS pid, SUM(clicks) AS clicks
    FROM patient_stats
    GROUP BY pid
    HAVING SUM(clicks)>0
    ORDER BY clicks DESC, pid ASC
  ")->fetchAll();
}
$sum_patients_period = array_sum(array_map(fn($r)=>(int)$r['clicks'],$top_patients));

$patients_by_day = $patients_by_week = [];
if (hasTable($db,'patient_daily')) {
  $q = $db->prepare("
    SELECT day, SUM(clicks) AS clicks
    FROM patient_daily
    WHERE day BETWEEN :s AND :e
    GROUP BY day ORDER BY day DESC
  ");
  $q->execute([':s'=>$start, ':e'=>$end]);
  $patients_by_day = $q->fetchAll();

  $q = $db->prepare("
    SELECT strftime('%Y-%W', day) AS yw, MIN(day) AS week_start, SUM(clicks) AS clicks
    FROM patient_daily
    WHERE day BETWEEN :s AND :e
    GROUP BY yw ORDER BY yw DESC
  ");
  $q->execute([':s'=>$start, ':e'=>$end]);
  $patients_by_week = $q->fetchAll();
}

/* ==========================================================
   SEITEN (Tagesdaten + Fallback)
   ========================================================== */
$pages_hint = '';
if (hasTable($db,'page_daily')) {
  $q = $db->prepare("
    SELECT
      CASE
        WHEN page IS NULL OR TRIM(page)='' OR page='/' THEN 'index.html'
        WHEN LOWER(page) LIKE '%/index' OR LOWER(page)='index' OR LOWER(page)='index.htm' THEN 'index.html'
        WHEN LOWER(page) LIKE '%.html' THEN LOWER(page)
        ELSE LOWER(page)||'.html'
      END AS norm_page,
      SUM(views) AS views
    FROM page_daily
    WHERE day BETWEEN :s AND :e
    GROUP BY norm_page
    HAVING views>0
    ORDER BY views DESC, norm_page ASC
  ");
  $q->execute([':s'=>$start, ':e'=>$end]);
  $top_pages = $q->fetchAll();
  if (!$top_pages) {
    $pages_hint = 'Hinweis: Keine Tagesdaten im gewählten Zeitraum – zeige kumulierte Gesamtsummen.';
    $top_pages = $db->query("
      SELECT
        CASE
          WHEN page IS NULL OR TRIM(page)='' OR page='/' THEN 'index.html'
          WHEN LOWER(page) LIKE '%/index' OR LOWER(page)='index' OR LOWER(page)='index.htm' THEN 'index.html'
          WHEN LOWER(page) LIKE '%.html' THEN LOWER(page)
          ELSE LOWER(page)||'.html'
        END AS norm_page,
        SUM(views) AS views
      FROM page_stats
      GROUP BY norm_page
      HAVING SUM(views)>0
      ORDER BY views DESC, norm_page ASC
    ")->fetchAll();
  }
} else {
  $pages_hint = 'Hinweis: Tabelle „page_daily“ fehlt – zeige kumulierte Gesamtsummen.';
  $top_pages = $db->query("
    SELECT
      CASE
        WHEN page IS NULL OR TRIM(page)='' OR page='/' THEN 'index.html'
        WHEN LOWER(page) LIKE '%/index' OR LOWER(page)='index' OR LOWER(page)='index.htm' THEN 'index.html'
        WHEN LOWER(page) LIKE '%.html' THEN LOWER(page)
        ELSE LOWER(page)||'.html'
      END AS norm_page,
      SUM(views) AS views
    FROM page_stats
    GROUP BY norm_page
    HAVING SUM(views)>0
    ORDER BY views DESC, norm_page ASC
  ")->fetchAll();
}
$sum_pages_period = array_sum(array_map(fn($r)=>(int)$r['views'],$top_pages));

$pages_by_day = $pages_by_week = [];
if (hasTable($db,'page_daily')) {
  $q = $db->prepare("
    SELECT day, SUM(views) AS views
    FROM page_daily
    WHERE day BETWEEN :s AND :e
    GROUP BY day ORDER BY day DESC
  ");
  $q->execute([':s'=>$start, ':e'=>$end]);
  $pages_by_day = $q->fetchAll();

  $q = $db->prepare("
    SELECT strftime('%Y-%W', day) AS yw, MIN(day) AS week_start, SUM(views) AS views
    FROM page_daily
    WHERE day BETWEEN :s AND :e
    GROUP BY yw ORDER BY yw DESC
  ");
  $q->execute([':s'=>$start, ':e'=>$end]);
  $pages_by_week = $q->fetchAll();
}

/* ==========================================================
   NUTZUNG (aus usage_stats)
   ========================================================== */
$q = $db->prepare("
  SELECT day, CASE WHEN seconds_total>86400 THEN 86400 ELSE seconds_total END AS seconds_total
  FROM usage_stats
  WHERE day BETWEEN :s AND :e
  ORDER BY day DESC
");
$q->execute([':s'=>$start, ':e'=>$end]);
$usage = $q->fetchAll();
$usage_total = array_sum(array_map(fn($r)=>(int)$r['seconds_total'],$usage));
?>
<!doctype html><meta charset="utf-8">
<title>1 Rettungsmittel – Metrics</title>
<style>
  :root{--bg:#0b1220;--panel:#111827;--border:#293241;--fg:#e5e7eb;--muted:#9ca3af;}
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:var(--bg);color:var(--fg);margin:24px}
  h1{margin:0 0 16px}
  .wrap{border:1px solid var(--border);border-radius:14px;padding:14px;background:linear-gradient(180deg,#0f172a,#0b1220)}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  table{border-collapse:collapse;width:100%;background:#0f172a;border:1px solid var(--border);border-radius:12px;overflow:hidden}
  th,td{padding:10px;border-bottom:1px solid #1f2937}
  th{background:#111827;text-align:left}
  .kpis{display:grid;grid-template-columns:repeat(4,minmax(180px,1fr));gap:12px;margin:12px 0}
  .card{background:#111827;border:1px solid var(--border);border-radius:12px;padding:12px}
  .big{font-size:22px;font-weight:800}
  .muted{color:var(--muted)}
  .right{text-align:right}
  .filter{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
  input[type="date"]{background:#0f172a;border:1px solid var(--border);color:var(--fg);padding:6px 8px;border-radius:8px}
  .btn{background:#1f2937;border:1px solid var(--border);color:var(--fg);padding:6px 10px;border-radius:10px;text-decoration:none}
  .btn:hover{filter:brightness(1.2)}
  .hint{color:#f59e0b;font-size:12px;margin:6px 0}
</style>

<h1>1 Rettungsmittel – Metrics</h1>
<div class="wrap">
  <div class="filter">
    <form method="get" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <label>Start: <input type="date" name="start" value="<?=htmlspecialchars($start)?>"></label>
      <label>Ende: <input type="date" name="end" value="<?=htmlspecialchars($end)?>"></label>
      <button class="btn" type="submit">Anwenden</button>
      <a class="btn" href="?preset=today">Heute</a>
      <a class="btn" href="?preset=7d">7 Tage</a>
      <a class="btn" href="?preset=30d">30 Tage</a>
      <a class="btn" href="?preset=year">Dieses Jahr</a>
      <span class="muted">Zeitraum: <?=$start?> bis <?=$end?></span>
    </form>
  </div>

  <div class="kpis">
    <div class="card"><div class="muted">Patienten-Klicks (Zeitraum)</div><div class="big"><?=n($sum_patients_period)?></div></div>
    <div class="card"><div class="muted">Seiten-Views (Zeitraum)</div><div class="big"><?=n($sum_pages_period)?></div></div>
    <div class="card"><div class="muted">Nutzungszeit (Zeitraum)</div><div class="big"><?=fmt_hms($usage_total)?></div></div>
    <div class="card"><div class="muted">Tage mit Nutzung</div><div class="big"><?=count($usage)?></div></div>
  </div>

  <div class="row">
    <div>
      <h3>Top-Patienten im Zeitraum</h3>
      <?php if ($patients_hint): ?><div class="hint"><?=$patients_hint?></div><?php endif; ?>
      <table>
        <tr><th>Patient</th><th class="right">Klicks</th></tr>
        <?php foreach ($top_patients as $r): ?>
          <tr><td><?='patient'.(int)$r['pid']?></td><td class="right"><?=n($r['clicks'])?></td></tr>
        <?php endforeach; ?>
        <tr><th>Summe</th><th class="right"><?=n($sum_patients_period)?></th></tr>
      </table>

      <h3>Patienten-Klicks pro Tag</h3>
      <table>
        <tr><th>Tag</th><th class="right">Klicks</th></tr>
        <?php foreach ($patients_by_day as $r): ?>
          <tr><td><?=htmlspecialchars($r['day'])?></td><td class="right"><?=n($r['clicks'])?></td></tr>
        <?php endforeach; ?>
      </table>

      <h3>Patienten-Klicks pro Woche</h3>
      <table>
        <tr><th>Woche (Start)</th><th class="right">Klicks</th></tr>
        <?php foreach ($patients_by_week as $r): ?>
          <tr><td><?=htmlspecialchars($r['yw'])?> (<?=htmlspecialchars($r['week_start'])?>)</td><td class="right"><?=n($r['clicks'])?></td></tr>
        <?php endforeach; ?>
      </table>
    </div>

    <div>
      <h3>Top-Seiten im Zeitraum</h3>
      <?php if ($pages_hint): ?><div class="hint"><?=$pages_hint?></div><?php endif; ?>
      <table>
        <tr><th>Seite</th><th class="right">Views</th></tr>
        <?php foreach ($top_pages as $r): ?>
          <tr><td><?=htmlspecialchars($r['norm_page'])?></td><td class="right"><?=n($r['views'])?></td></tr>
        <?php endforeach; ?>
        <tr><th>Summe</th><th class="right"><?=n($sum_pages_period)?></th></tr>
      </table>

      <h3>Seiten-Views pro Tag</h3>
      <table>
        <tr><th>Tag</th><th class="right">Views</th></tr>
        <?php foreach ($pages_by_day as $r): ?>
          <tr><td><?=htmlspecialchars($r['day'])?></td><td class="right"><?=n($r['views'])?></td></tr>
        <?php endforeach; ?>
      </table>

      <h3>Seiten-Views pro Woche</h3>
      <table>
        <tr><th>Woche (Start)</th><th class="right">Views</th></tr>
        <?php foreach ($pages_by_week as $r): ?>
          <tr><td><?=htmlspecialchars($r['yw'])?> (<?=htmlspecialchars($r['week_start'])?>)</td><td class="right"><?=n($r['views'])?></td></tr>
        <?php endforeach; ?>
      </table>
    </div>
  </div>

  <h3>Nutzungsdauer (pro Tag im Zeitraum)</h3>
  <table>
    <tr><th>Tag</th><th class="right">Sekunden</th><th class="right">hh:mm:ss</th></tr>
    <?php foreach ($usage as $r): ?>
      <tr><td><?=htmlspecialchars($r['day'])?></td><td class="right"><?=n($r['seconds_total'])?></td><td class="right"><?=fmt_hms((int)$r['seconds_total'])?></td></tr>
    <?php endforeach; ?>
  </table>
</div>
