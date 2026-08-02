# Roof Arcade - NanoSeal NB

A collection of fast, free, 20-second browser games about roof maintenance and New Brunswick weather.

## Structure

```
roof-arcade/
├── index.html           # Landing page
├── style.css            # Landing page styles
├── game-card-data.js    # Game card data (shared by landing page only)
├── README.md            # This file
├── gutter-guardian/     # Game 1
├── moss-attack/         # Game 2
├── freeze-thaw-defender/ # Game 3
├── ice-dam-escape/      # Game 4
└── granule-grab/        # Game 5
```

The Fall Roof Challenge is deployed separately at `/fall-challenge/` and linked from the arcade page.

## How to Test Locally
```bash
# Test the landing page
python3 -m http.server 8080
# Visit http://localhost:8080/

# Test an individual game
cd gutter-guardian
python3 -m http.server 8081
# Visit http://localhost:8081/
```

## How to Deploy
1. Upload the entire `roof-arcade` folder to `public_html/` on shared hosting
2. The arcade page will be live at `https://nanosealnb.ca/roof-arcade/`
3. Each game folder works independently at its own URL:
   - `https://nanosealnb.ca/roof-arcade/gutter-guardian/`
   - `https://nanosealnb.ca/roof-arcade/moss-attack/`
   - etc.

Alternatively, upload each game folder directly to `public_html/` (not inside roof-arcade/) for URLs like `https://nanosealnb.ca/gutter-guardian/`. Update the URLs in `game-card-data.js` to match.

## Analytics
- Meta Pixel: 417200467669469
- GA4: G-T69MEZVL30
- Arcade events: arcade_viewed, arcade_game_selected, assessment_clicked
- Game events: game_viewed, game_started, game_completed, game_failed, game_restarted, share_clicked, share_completed, assessment_clicked

## Deployment Checklist
- [ ] Upload roof-arcade/ folder to public_html/
- [ ] Verify landing page loads at /roof-arcade/
- [ ] Test each game card link
- [ ] Verify CTA links to https://nanosealnb.ca/contact/
- [ ] Verify all See Also links
- [ ] Test on mobile (portrait + landscape)
- [ ] Test on desktop
- [ ] Verify no external dependencies (no npm, no Node.js required)
- [ ] Verify analytics IDs match (Pixel: 417200467669469, GA4: G-T69MEZVL30)
- [ ] Confirm CTA wording: "REQUEST YOUR FREE ASSESSMENT" (not "Book your assessment")