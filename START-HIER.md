# Ring Drive starten

De native demo is bedoeld voor een iPhone-simulator in Xcode 26.1. De meegeleverde app in `Build/RingDrive.app` is voor Apple Silicon en de simulator; hij is niet ondertekend voor een fysieke iPhone.

## Snelste route

1. Open `RingDrive.xcodeproj` in Xcode.
2. Kies bovenin **RingDrive** en een **iPhone-simulator**. Druk op Run.
3. Druk op **Run rear-door demo**. Video blijft vergrendeld.
4. Druk op **Listen to explanation** en laat de gesproken uitleg uitspreken.
5. Kies **Find a safe place to stop**, daarna **Simulate Maps handoff**. Sluit het bericht.
6. Kies **Simulate arrival & standstill**. Wacht 20 seconden en bevestig **I'm safely parked**.
7. Open **Review incident video**. Zet de app daarna op de achtergrond: de video sluit en vergrendelt opnieuw.

De app staat ook al op de lokale iPhone 17 Pro-simulator. Met een draaiende simulator kun je de meegeleverde build installeren en starten via `./scripts/run_demo.sh`.

## Echte Apple Maps

Open **Demo & Ring** en zet **Offline stop-search rehearsal** uit. Zoek opnieuw een stopplek en kies **Navigate with Apple Maps**. Dit roept echt MapKit en Apple Maps aan. In de sensordemo krijgt Maps een expliciet gemarkeerd startpunt in Amsterdam; op een echte iPhone met sensormodus gebruikt Maps de huidige locatie.

## Ring aansluiten

Gebruik het OAuth-access-token uit de officiële Ring Simulator/Playground. Hetzelfde token werkt voor **Device List**, **Event History** en **Users API**; er is geen token per endpoint nodig.

1. Voer vanuit deze projectmap `node scripts/setup_ring.mjs` uit. Dit maakt `Relay/.env.local` aan en bewaart bestaande configuratie.
2. Vul alleen `RING_ACCESS_TOKEN` lokaal in dat bestand in, zonder `Bearer ` ervoor. Deel het token niet in de chat of screenshots. Client ID en client secret zijn voor deze simulatorroute niet nodig.
3. Start de backend: `cd Relay` en daarna `node --env-file=.env.local server.mjs`.
4. Open in de iPhone-app **Demo & Ring → Official Ring runtime**. Gebruik `http://127.0.0.1:8787` en vul bij **Backend client key** de aparte `RELAY_CLIENT_TOKEN` uit je lokale bestand in.
5. Kies **Connect & discover Ring devices**, wijs Front/Side/Rear aan camera's toe en kies **Poll Ring event history** na een simulator-event. Ring-tokens blijven uitsluitend op de backend.

Voor een echte verbindingstest voer je vanuit de projectmap `node scripts/verify_ring.mjs` uit. Deze toont alleen resultaat-aantallen en schrijft een lokaal bewijs zonder identifiers of secrets. Een verlopen token vervang je in `.env.local`; start daarna de backend opnieuw.

Werk je op een andere computer? Download dan de apart geleverde `Ring-token-invoer.html` en open die lokaal in een actuele browser. Plak daarin je simulator-token, kies **Versleutel token** en stuur alleen de tekst die begint met `RINGDRIVE-TOKEN-BOX:` terug. Het bestand bevat alleen de publieke sleutel van deze werkmap; de privésleutel blijft lokaal. Een bestandsvoorvertoning op een telefoon kan JavaScript blokkeren.

Echte geauthenticeerde Ring-runtime is pas bewezen na een succesvolle test met je lokaal ingevulde token. Leg ook een echt simulator-event in de native incidentflow vast voor de hackathoninzending. De documentatie-MCP die je deelde geeft documentatie, geen toegang tot camera-events.

## CarPlay

**Preview CarPlay flow** is een interactieve simulatie in de iPhone-app. De Live Activity/widget-extensie is echte iOS-code; we hebben de weergave op Apple's aparte CarPlay Simulator nog niet lokaal gevalideerd. Een interactieve volledige CarPlay-app vereist Apple-goedkeuring en provisioning. De code staat klaar achter `FULL_CARPLAY`; er is geen entitlement toegekend.

De volledige architectuur, installatie, foutscenario's, teststatus, bronnen en het demoscript van 2:45 staan in [README.md](README.md) en [docs/VERIFICATION.md](docs/VERIFICATION.md).
