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

Open de officiële Ring Developer Playground via de link in **Demo & Ring**. Zodra je toegang hebt, genereer je daar een token en voer je die uitsluitend in het beveiligde veld van de app in. De app roept dan de officiële device-, event- en video-endpoints aan. Deel tokens niet in chat of screenshots.

Zonder deze toegang werkt de lokale demonstratie, maar is echte geauthenticeerde Ring-runtime nog niet bewezen. Die stap is nodig voor de hackathoninzending.

## CarPlay

**Preview CarPlay flow** is een interactieve simulatie in de iPhone-app. De Live Activity/widget-extensie is echte iOS-code; we hebben de weergave op Apple's aparte CarPlay Simulator nog niet lokaal gevalideerd. Een interactieve volledige CarPlay-app vereist Apple-goedkeuring en provisioning. De code staat klaar achter `FULL_CARPLAY`; er is geen entitlement toegekend.

De volledige architectuur, installatie, foutscenario's, teststatus, bronnen en het demoscript van 2:45 staan in [README.md](README.md) en [docs/VERIFICATION.md](docs/VERIFICATION.md).
