let isTimerRunning = false;
let timerSeconds = 0;
let timerInterval;

// Funktion, um den Timer zu starten
function startTimer() {
    if (isTimerRunning) return;

    isTimerRunning = true;
    timerInterval = setInterval(function () {
        timerSeconds++;
        console.log('Timer läuft: ' + timerSeconds + ' Sekunden');
        saveTime();
    }, 1000);
}

// Funktion, um den Timer zu stoppen
function stopTimer() {
    if (!isTimerRunning) return;

    clearInterval(timerInterval);
    isTimerRunning = false;
    saveTime();
    console.log('Timer gestoppt');
}

// Funktion, um die Zeit zu speichern
function saveTime() {
    const currentPage = window.location.pathname;
    localStorage.setItem(`time_${currentPage}`, timerSeconds);
}

// Funktion, um die gespeicherte Zeit für eine Patientenseite zu laden
function loadTime() {
    const currentPage = window.location.pathname;
    const savedTime = localStorage.getItem(`time_${currentPage}`);
    timerSeconds = savedTime ? parseInt(savedTime) : 0;
}

// Funktion zum Zurücksetzen der Zeit für die aktuelle Seite
function resetCurrentPageTime() {
    const currentPage = window.location.pathname;
    localStorage.removeItem(`time_${currentPage}`);
    timerSeconds = 0;
    console.log(`Zeit für ${currentPage} zurückgesetzt`);
}

// Funktion, um alle Zeiten zurückzusetzen (für Status 4)
function resetAllTimes() {
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith('time_') || key.startsWith('category_')) {
            localStorage.removeItem(key);
        }
    });

    console.log('Alle Zeiten und Kategorien wurden zurückgesetzt');
}

// Funktion, um die Gesamtzeit als Summe aller Patientenzeiten zu berechnen
function calculateTotalTime() {
    let totalTime = 0;
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith('time_')) { // Alle Patientenzeiten durchgehen
            totalTime += parseInt(localStorage.getItem(key)) || 0;
        }
    });
    return totalTime;
}

// Funktion zur Formatierung der Zeit (in Sekunden) in MM:SS
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

// Gesamtzeit anzeigen
function displayTotalTime() {
    const totalTime = calculateTotalTime(); // Gesamtzeit berechnen
    const totalTimeElement = document.getElementById('gesamtzeit');
    if (totalTimeElement) {
        totalTimeElement.textContent = formatTime(totalTime); // Gesamtzeit anzeigen
    }
}

// Funktion zum Speichern der Sichtungskategorie
function saveCategory(category) {
    const currentPage = window.location.pathname;
    localStorage.setItem(`category_${currentPage}`, category);
    console.log(`Kategorie gespeichert: ${category}`);
}

// Funktion zum Laden der Sichtungskategorie
function loadCategory() {
    const currentPage = window.location.pathname;
    return localStorage.getItem(`category_${currentPage}`) || 'Nicht zugewiesen';
}

// Event-Listener für den "Einsatzende"-Button
document.getElementById('einsatzendeButton')?.addEventListener('click', function () {
    stopTimer();
    window.location.href = "/Auswertung.html"; // Weiterleitung zur Auswertungsseite
});

// Event-Listener für den "Status 1"-Button (nur aktuelle Zeit zurücksetzen)
document.getElementById('status1Button')?.addEventListener('click', function () {
    resetCurrentPageTime(); // Nur die Zeit der aktuellen Seite zurücksetzen
    startTimer(); // Timer neu starten
});

// Event-Listener für den "Status 4"-Button (alle Zeiten zurücksetzen)
document.getElementById('status4Button')?.addEventListener('click', function () {
    resetAllTimes(); // Alle Zeiten und Kategorien zurücksetzen
});

// Funktion, um die Zeit beim Verlassen der Seite zu speichern
window.addEventListener("beforeunload", saveTime);

// Gesamtzeit anzeigen, wenn die Seite geladen wird
window.onload = function () {
    loadTime(); // Lade Zeit für die aktuelle Patientenseite

    if (!isTimerRunning) {
        startTimer(); // Starte den Timer, falls er noch nicht läuft
    }

    // Wenn die Seite die Auswertungsseite ist, zeige die Gesamtzeit an
    if (window.location.pathname.includes("Auswertung.html")) {
        displayTotalTime(); // Gesamtzeit auf der Auswertungsseite anzeigen
    }
};
