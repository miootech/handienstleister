# HAN Dienstleister GmbH - Enterprise Website

Produktionsnahe statische Unternehmenswebsite mit Firebase Backend, Admin Dashboard, Kontaktanfragen, Bewertungsfreigabe, Terminbestätigung und Resend E-Mail-Versand.

## Struktur

- `/css`, `/js`: bestehendes Frontend, refactored ohne Framework
- `/services`, `/utils`: Firebase Client, Formularlogik, Validierung
- `/admin`: geschütztes Admin Dashboard
- `/firebase`: öffentliche Firebase-Konfiguration für den Browser
- `/functions`: Firebase Cloud Functions für sichere Schreibvorgänge und E-Mails
- `firestore.rules`, `storage.rules`: rollenbasierte Sicherheitsregeln
- `firebase.json`, `_headers`, `_redirects`: Hosting und Security Header
- `robots.txt`, `sitemap.xml`, `site.webmanifest`: SEO und PWA-Basis

## Lokale Nutzung

Die Website ist statisch. Zum Testen reicht ein lokaler Webserver, damit JavaScript-Module korrekt geladen werden.

```bash
npx serve .
```

Danach die Website im Browser öffnen und `firebase/firebaseConfig.js` mit echten Firebase-Werten füllen.

## Firebase Einrichtung

1. Firebase Projekt erstellen.
2. Authentication aktivieren: E-Mail/Passwort.
3. Firestore aktivieren.
4. Storage aktivieren.
5. Functions aktivieren, Region `europe-west3`.
6. `.firebaserc.example` nach `.firebaserc` kopieren und `YOUR_PROJECT_ID` ersetzen.
7. `firebase/firebaseConfig.js` mit den Web-App-Daten aus Firebase befüllen.
8. Regeln und Indexe deployen:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

## Cloud Functions

```bash
cd functions
npm install
firebase functions:secrets:set RESEND_API_KEY
firebase deploy --only functions
```

Benötigte Umgebungswerte:

- `RESEND_API_KEY`
- `MAIL_FROM`
- `ADMIN_EMAIL`
- `SUPER_ADMIN_EMAIL`
- `PUBLIC_DOMAIN`
- `COMPANY_ID`

## Rollen

Rollen werden über Firebase Custom Claims gesetzt:

- `superAdmin`: vollständiger Zugriff, kann Rollen setzen
- `companyAdmin`: Zugriff auf Anfragen, Bewertungen, Termine und Unternehmensdaten des eigenen `companyId`

Die Function `setUserRole` setzt Claims und schreibt zusätzlich ein Dokument in `users/{uid}`. Der erste Super Admin muss einmalig über Admin SDK, Firebase CLI Script oder eine temporäre sichere Initialisierungsfunktion gesetzt werden.

## Kontaktformular

Das Formular validiert clientseitig und sendet über `submitContactRequest`.

Serverseitig enthalten:

- Pflichtfelder
- E-Mail- und Telefonprüfung
- Honeypot
- Rate Limiting
- Sanitizing
- Firestore Speicherung
- Eingangsbestätigung an Kunde
- Benachrichtigung an Admin und Super Admin

## Bewertungen

Öffentliche Bewertungen werden über `submitReview` eingereicht und erhalten zuerst den Status `pending`. Erst nach Freigabe im Admin Dashboard erscheinen sie über `listApprovedReviews` auf der Website.

Unterstützt:

- 1 bis 5 Sterne in 0,5-Schritten
- optionales Profilbild
- optionaler Bildanhang
- Antwort des Unternehmens
- Durchschnittsbewertung
- Sortierung und Pagination

## Termine

Angenommene Anfragen können im Dashboard bestätigt werden. Die Function `confirmAppointment` speichert Termindaten, versendet eine HTML-E-Mail und hängt eine kompatible `.ics` Kalenderdatei an.

## Cloudflare Pages Deployment

1. Repository mit Cloudflare Pages verbinden.
2. Build Command leer lassen.
3. Output Directory: `/`
4. Umgebungsvariablen nur für Cloudflare setzen, falls eigene Build-Schritte ergänzt werden.
5. Domain in Cloudflare verbinden.
6. HTTPS und HSTS aktivieren.

Die Datei `_headers` setzt Security Header. `_redirects` sorgt dafür, dass `/admin` direkt das Dashboard lädt.

## Vercel Alternative

Für Vercel ist kein Build nötig. Projekt importieren, Framework auf `Other` setzen und das Root-Verzeichnis veröffentlichen. Firebase Functions laufen weiterhin separat über Firebase.

## Backup Strategie

- Firestore: täglicher Export in einen separaten Google Cloud Storage Bucket.
- Storage: Bucket Lifecycle und regelmäßige Kopie in Backup-Bucket.
- Functions: Quellcode im Git-Repository versionieren.
- Firebase Config und Secrets: Secrets nicht im Repository speichern, sondern dokumentiert in einem Passwortmanager.

Beispiel Firestore Export:

```bash
gcloud firestore export gs://YOUR_BACKUP_BUCKET/firestore/$(date +%Y-%m-%d)
```

## Restore

```bash
gcloud firestore import gs://YOUR_BACKUP_BUCKET/firestore/YYYY-MM-DD
```

Storage Dateien können über `gcloud storage cp` oder Cloud Storage Transfer zurückkopiert werden.

## Vor Livegang prüfen

- Impressum mit echten Register-, Geschäftsführer- und USt-Daten befüllen.
- Datenschutz juristisch final prüfen.
- Firebase Projektwerte eintragen.
- Resend Domain verifizieren.
- Super Admin initial setzen.
- Cloudflare Pages Domain verbinden.
- Testanfrage, Testbewertung und Testtermin durchführen.
- Lighthouse und Security Header im finalen Deployment prüfen.
