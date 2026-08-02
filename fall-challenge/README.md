# Can Your Roof Survive Fall? - NanoSeal NB

A 20-second browser game where players tap falling hazards (leaves, rain, moss, branches) before they damage an asphalt-shingle roof. Built with pure HTML5 Canvas, CSS3, and vanilla JavaScript. No dependencies, no frameworks, no build step.

## Project Structure

```
fall-challenge/
├── index.html   # Markup, SEO metadata, overlays
├── style.css    # All styling, responsive layout, accessibility
├── game.js      # Game engine (Canvas rendering, logic, input)
└── README.md    # This file
```

## How to Test Locally

Open `fall-challenge/index.html` directly in any modern browser, or serve the folder with any static server:

```bash
cd fall-challenge
python3 -m http.server 8080
```

Then visit `http://localhost:8080/` in your browser.

## How to Upload to Shared Hosting

### Option A: cPanel File Manager

1. Log in to your hosting control panel (cPanel, SiteGround, etc.)
2. Open **File Manager**
3. Navigate to the `public_html` directory (or the web root for nanosealnb.ca)
4. Create a new folder named `fall-challenge`
5. Upload all four files (`index.html`, `style.css`, `game.js`, `README.md`) into that folder
6. The game will be live at `https://nanosealnb.ca/fall-challenge/`

### Option B: FTP / SFTP

1. Connect to your server via FTP/SFTP (FileZilla, Cyberduck, etc.)
2. Navigate to `public_html/`
3. Create a folder named `fall-challenge`
4. Upload all files into that folder
5. Visit `https://nanosealnb.ca/fall-challenge/`

### Placing at /fall-challenge/

The URL is determined entirely by the folder name. As long as the folder is named `fall-challenge` and sits in the web root (`public_html/`), the game will appear at `https://nanosealnb.ca/fall-challenge/`. No server-side configuration is needed.

## Difficulty Configuration

All gameplay constants are in one `CONFIG` object at the top of `game.js`. Key values:

| Constant | Default | What It Controls |
|---|---|---|
| `gameDuration` | 20 | Total seconds the player must survive |
| `warningTime` | 15 | Seconds remaining when WEATHER WARNING triggers |
| `maxHealth` / `startHealth` | 100 | Roof health pool |
| `healthPerMiss.leaf` | 4 | Damage from a missed leaf |
| `healthPerMiss.rain` | 3 | Damage from missed rain |
| `healthPerMiss.moss` | 6 | Damage from missed moss spore |
| `healthPerMiss.branch` | 12 | Damage from a missed branch |
| `points.leaf` | 10 | Score for tapping a leaf |
| `points.rain` | 15 | Score for tapping rain |
| `points.moss` | 20 | Score for tapping moss |
| `points.branch` | 30 | Score for tapping a branch |
| `baseSpawnInterval` | 950 | ms between hazard spawns at start |
| `minSpawnInterval` | 280 | Fastest spawn rate |
| `spawnRampFactor` | 0.035 | How quickly spawns ramp up |
| `warningSpawnMultiplier` | 0.55 | Spawn interval multiplied by this after warning |
| `baseFallSpeed` | 90 | Initial hazard fall speed (px/sec) |
| `maxFallSpeed` | 260 | Maximum fall speed |
| `speedRampPerSec` | 5 | Speed increase per second |
| `warningSpeedBoost` | 80 | Extra fall speed added after warning |
| `hazardWeights` | varied | Relative probability of each hazard type |

To make the game easier: increase `maxHealth`, decrease `healthPerMiss` values, increase `baseSpawnInterval`, decrease `warningSpeedBoost`.

To make it harder: do the opposite.

## Replacing the Procedural Background with an Image

The house, roof, sky, and ground are all drawn procedurally on Canvas. To use a real image instead:

1. Place your image file (e.g. `house.png`) in the `fall-challenge/` folder
2. In `game.js`, inside the IIFE at the top (after the `CONFIG` block), add:

```javascript
const houseImage = new Image();
houseImage.src = 'house.png';
```

3. In the `drawHouse()` function, replace the procedural drawing code with:

```javascript
function drawHouse() {
  const g = getRoofGeometry();
  ctx.save();
  ctx.translate(shakeOffsetX, shakeOffsetY);
  // Draw image scaled to fit the house area
  ctx.drawImage(houseImage, g.leftEdge - 10, g.peakY, g.rightEdge - g.leftEdge + 20, cssH - g.peakY);
  ctx.restore();
}
```

4. Keep the `getRoofYAt()` function unchanged so impact detection still works with the original roof geometry. If your image has a different roof shape, update `getRoofGeometry()` and `getRoofYAt()` to match.

## Connecting Analytics Hooks

The `trackGameEvent(eventName, data)` function in `game.js` currently logs to console. Events fired:

- `game_started` - player clicks START
- `game_completed` - player survives 20 seconds
- `game_failed` - roof health reaches zero
- `game_restarted` - player clicks TRY AGAIN
- `assessment_clicked` - player clicks the assessment button

### Meta Pixel

Add your Pixel base code in `index.html` `<head>`, then update `trackGameEvent`:

```javascript
function trackGameEvent(eventName, data) {
  console.log('[GameEvent]', eventName, data || {});
  if (typeof window.fbq === 'function') {
    window.fbq('trackCustom', eventName, data || {});
  }
}
```

### Google Analytics 4

Add your GA4 tag in `index.html`, then:

```javascript
function trackGameEvent(eventName, data) {
  console.log('[GameEvent]', eventName, data || {});
  if (typeof window.gtag === 'function') {
    window.gtag('event', eventName, data || {});
  }
}
```

### GoHighLevel

Use a custom event webhook or the GHL tracking script, then add the call in `trackGameEvent` as above.

## Deployment Checklist

- [ ] All four files present: `index.html`, `style.css`, `game.js`, `README.md`
- [ ] Folder named `fall-challenge` in web root (`public_html/`)
- [ ] Test on iPhone (Safari) - portrait and landscape
- [ ] Test on Android (Chrome) - portrait and landscape
- [ ] Test on desktop browser (Chrome, Firefox, Safari, Edge)
- [ ] Verify no horizontal scrolling on any device
- [ ] Verify touch tapping registers consistently
- [ ] Verify game restarts without page reload
- [ ] Verify game pauses when tab is hidden
- [ ] Verify WEATHER WARNING appears at ~15 seconds
- [ ] Verify end screen shows correct result text
- [ ] Verify assessment button links to `https://nanosealnb.ca/contact/`
- [ ] Verify CTA reads "REQUEST YOUR FREE ASSESSMENT" (not "Book your assessment")
- [ ] Verify tagline reads "You cannot control New Brunswick weather, but you can prepare your roof for it."
- [ ] Verify small info line reads "Real roof problems are easier to manage when caught early."
- [ ] Verify no external network requests (check browser DevTools Network tab)
- [ ] Verify total file size under 150 KB
- [ ] Verify `trackGameEvent` logs to console for all five events
- [ ] Verify Canvas fallback message shows on unsupported browsers
- [ ] Verify `prefers-reduced-motion` disables shake effects
- [ ] Verify no prize guarantee language exists anywhere
- [ ] Verify canonical URL is `https://nanosealnb.ca/fall-challenge/`
- [ ] Verify Open Graph and Twitter Card metadata present
- [ ] Add a `share-image.png` (1200x630px) for social sharing (optional, referenced in metadata)

## Browser Compatibility

Tested target browsers:
- Safari 14+ (iOS and macOS)
- Chrome 90+ (Android and desktop)
- Firefox 88+ (desktop)
- Edge 90+ (desktop)

The game uses standard Canvas 2D API, `requestAnimationFrame`, `performance.now()`, and CSS flexbox. No experimental features are used.

## License

Proprietary - NanoSeal NB. All rights reserved.