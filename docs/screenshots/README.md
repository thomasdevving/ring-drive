# Native screenshot provenance

All images are unedited captures of the iPhone 17 Pro iOS 26.1 Simulator, produced during the final native XCTest run. They are not generated mock-ups.

- `driving.png`: labeled synthetic rear-door incident, video locked, explanation available.
- `parked.png`: review unlocked only after the real 20-second simulated-sensor interval plus explicit confirmation.
- `review.png`: the original locally authored synthetic rehearsal clip in guarded AVPlayer.
- `mapkit.png`: real Apple MapKit search results near the disclosed Amsterdam demo origin.
- `maps.png`: Apple Maps actually opened after the handoff; its first-use notification onboarding is still visible. This is evidence of the application handoff, not a completed driving navigation session. Complete Apple Maps onboarding before recording a demo. The Dynamic Island also shows the Ring Drive Live Activity.

These captures do not prove authenticated Ring runtime, actual CarPlay presentation or physical-device parked detection. Those remaining checks are listed in ../VERIFICATION.md.

Additional shipping raster evidence under `.impeccable/review/`: `backend-connection-phone.png` is an unedited native XCTest attachment from the backend update. `token-input-desktop.png` and `token-input-mobile.png` are unedited installed-Chrome screenshots of the actual standalone HTML utility at widths 960 and 390, with no token or encrypted envelope displayed. They were captured after a fake-token browser round trip, then reloading the empty form. They are authored UI captures, not AI-generated media, and do not prove physical Safari/phone support or real Ring authentication.
