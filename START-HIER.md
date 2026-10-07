# Ring Drive starten

De native demo is bedoeld voor een iPhone-simulator in Xcode 26.1. De meegeleverde app in `Build/RingDrive.app` is voor Apple Silicon en de simulator; hij is niet ondertekend voor een fysieke iPhone.

## Op je eigen iPhone

Het project compileert ook voor een fysieke iPhone met **iOS 26 of nieuwer**. Er is nog geen ondertekende of op afstand installeerbare build. Een simulator-app of ongetekende app downloaden installeert hem niet op je telefoon.

- Met je Mac erbij: voeg je Apple-account toe in Xcode, selecteer je Personal Team bij **Signing & Capabilities** voor app en widget, verbind je iPhone, zet Developer Mode aan wanneer Xcode daarom vraagt en kies je iPhone als Run-bestemming. Een gratis account ondersteunt lokaal testen via Xcode; provisioning verloopt na zeven dagen. Xcode kan vragen de bundle identifiers uniek te maken.
- Op afstand: TestFlight vereist een betaald Apple Developer-lidmaatschap, signing/provisioning en een upload naar App Store Connect. Die zijn nog niet geconfigureerd. De volledige CarPlay-entitlement blijft een aparte aanvraag.

Met **Run rear-door demo** kun je na installatie de volledige synthetische flow zonder backend doorlopen. Voor echte Ring-events moet de backend via HTTPS bereikbaar zijn vanaf je iPhone; `127.0.0.1` op de telefoon verwijst naar de telefoon zelf. Er is nog geen backend gepubliceerd.

Bronnen: [Apple-account en lokaal testen](https://developer.apple.com/help/account/basics/about-your-developer-account), [TestFlight](https://developer.apple.com/testflight/).

## Snelste route

1. Open `RingDrive.xcodeproj` in Xcode.
2. Kies bovenin **RingDrive** en een **iPhone-simulator**. Druk op Run.
3. Druk op **Run rear-door demo**. Video blijft vergrendeld.
4. Druk op **Listen to explanation** en laat de gesproken uitleg uitspreken.
5. Kies **Find a safe place to stop**, daarna **Simulate Maps handoff**. Sluit het bericht.
6. Kies **Simulate arrival & standstill**. Wacht 20 seconden en bevestig **I'm safely parked**.
7. Open **Review incident video**. Zet de app daarna op de achtergrond: de video sluit en vergrendelt opnieuw.

De app staat ook al op de lokale iPhone 17 Pro-simulator. Met een draaiende simulator kun je de meegeleverde build installeren en starten via `./scripts/run_demo.sh`.

## Incidenttijdlijn en vervolgactiviteit

Na stap 6 kun je **Incident timeline** openen. Camera-waarnemingen, beoordelingen en acties staan op tijdsvolgorde. Klap een camera-waarneming open voor de cameranaam, bron, tijdstip en **Review this camera moment** bij echte Ring-evidence. Bij de synthetische demo heet dit **Review illustrative demo clip**: het meegeleverde filmpje illustreert het scenario en is geen opname van dat specifieke event. De tijdlijn vergrendelt weer zodra de parkeerverificatie vervalt of de app naar de achtergrond gaat. Opgeslagen oudere incidenten houden hun metadata; video review gebruikt het huidige incident en zijn parkeerbeveiliging.

Voor vervolggebeurtenissen open je **Demo & Ring → Update this synthetic incident**:

1. Kies **Add continuing activity**. Het incidentnummer blijft gelijk; de tijdlijn groeit en de navigatiestap blijft behouden. **Urgent alert requests** blijft op één staan.
2. Kies **Repeat the last delivery**. Het aantal waarnemingen groeit niet: deze levering is een duplicaat.
3. Kies **Simulate two departure observations**. De demo voegt direct één vertrekwaarneming toe en na een echte wachttijd van tien seconden de tweede. Het incident wordt **Resolved**; de route en videobeveiliging blijven behouden.
4. Kies **Simulate activity returning**. Hetzelfde incident wordt opnieuw actief en vraagt opnieuw om gesproken uitleg. Een heropende urgente waarschuwing heeft een wachttijd van 120 seconden sinds de vorige waarschuwing.

Stilte, lage betrouwbaarheid of een verlopen tijdvenster sluiten een urgent incident niet af. Afsluiten vereist twee verschillende, voldoende betrouwbare vertrekwaarnemingen van de relevante camera/module, minstens tien seconden uit elkaar, na de laatste activiteit. Een urgente achterdeurmelding wordt niet afgesloten door vertrek bij de voordeur. **Resolved** betekent dat de waargenomen activiteit is geëindigd; het bevestigt niet dat het hele huis veilig is.

De huidige Ring motion/doorbell-input levert geen expliciet vertrekbewijs. Automatisch afsluiten wordt daarom eerlijk met synthetische vertrekwaarnemingen gedemonstreerd. Echte Ring-incidenten blijven actief zolang dit bewijs ontbreekt; beeldanalyse is in deze uitbreiding niet toegevoegd.

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

De volledige architectuur, installatie, foutscenario's, teststatus, bronnen en het demoscript van 2:55 staan in [README.md](README.md) en [docs/VERIFICATION.md](docs/VERIFICATION.md).
