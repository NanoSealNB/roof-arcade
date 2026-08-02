# Gutter Guardian - NanoSeal NB

## How to Test Locally
```bash
cd gutter-guardian
python3 -m http.server 8080
```
Visit `http://localhost:8080/`

## How to Deploy
1. Upload the `gutter-guardian` folder to `public_html/` on shared hosting
2. Game will be live at `https://nanosealnb.ca/gutter-guardian/`

## Difficulty Configuration
All gameplay constants are in the `CONFIG` object at the top of `game.js`.

## Analytics
- Meta Pixel: 417200467669469
- GA4: G-T69MEZVL30
- Events: game_viewed, game_started, game_completed, game_failed, game_restarted, share_clicked, share_completed, assessment_clicked

## Deployment Checklist
- [ ] Upload folder to public_html/
- [ ] Test on mobile (portrait + landscape)
- [ ] Test on desktop
- [ ] Verify CTA links to https://nanosealnb.ca/contact/
- [ ] Verify sharing works
- [ ] Verify no external dependencies