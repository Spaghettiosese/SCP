# SCP: Epsilon-11 — Site-80 Tech Demo

A first-person shooter tech demo set in the SCP universe, built entirely on the
**ShapeForge** WebGL2 engine (from `Spaghettiosese/Engine`, branch `claude/keen-hamilton-nk8bdq`).
Every model — weapons, arms, operators, Class-D, SCP-173, the helicopter, the facility — is
assembled from parametric shapes and modifiers; every animation is synthesized or posed with IK
at runtime. No textures, meshes or sound files are loaded: signage is drawn on canvases and all
audio is generated with WebAudio.

You are **ROOK**, fifth member of Mobile Task Force Epsilon-11 "Nine-Tailed Fox", sent with four
AI squadmates to secure Site-80 after a containment breach.

```bash
npm start            # http://localhost:8080  (any static server works; ES modules need http://)
```

## The demo (two areas)

1. **Opening cutscene** — the squad flies in through a thunderstorm aboard a Foundation Black Hawk,
   with an Overwatch briefing (hold SPACE to skip).
2. **Area 1 — Gate B surface checkpoint (night, storm).** Clear Class-D rioters from the yard,
   override the blast door at the terminal, hold while it grinds open against a second wave,
   and board the freight elevator. Sweeping searchlight with real-time shadows, lightning,
   rain, wet asphalt, a burning van.
3. **Area 2 — Heavy Containment Zone, Sector 2.** Power is out: red beacons and your weapon light
   (which casts shadows). Restore the main breaker, clear the D-Class holding cells, then find
   SCP-173 — and keep your eyes on it.

### Mechanics
- **5 modern primaries + 2 sidearms:** M4A1 Block II (holo), MP7A2 SD (suppressed PDW),
  Mk 17 SCAR-H (7.62), M1014 (shell-by-shell reload), M110 SASS (4× scope, suppressed),
  Glock 17 (with light), Desert Eagle .50. Fire modes, recoil springs, bloom/spread, damage
  falloff, headshots, tactical vs. empty reloads (bolt catch / slide release), inspect, melee,
  frag grenades, medkits. Swap primaries at the armory crate on the LZ.
- **Fully procedural first-person arms**: two-bone IK hands on every gun, magazine drops and
  fetches, sway, bob, tactical sprint, ADS, lean.
- **Squad (CoD-style nameplates):** look at a squadmate to see rank insignia, name, callsign,
  role and health. Kestrel (LT, team lead), Hex (SSgt, breacher), Grim (Sgt, marksman), Patch
  (Cpl, corpsman — heals you when you're hurt). They follow, engage, call out contacts,
  reloads and blinks.
- **Class-D:** armed rioters reposition and shoot; unarmed ones charge and swing. Hold your
  sights on an unarmed one up close and they may **surrender** (detained counts on the stats).
- **SCP-173:** moves only when nobody is looking. Your blink meter drains; blink manually with
  **X** when the squad has eyes on it (the HUD shows how many are watching). Blackouts and
  flicker count as not looking — night vision (**N**) and your light (**T**) help. Get within
  2 m while it's observed and hold **F** to deploy the containment restraint.
- **BF2042-inspired HUD:** big ammo counter, slot bar with gun silhouettes rendered from the
  actual models, health bar, compass tape, rotating minimap, kill feed, world objective markers,
  radio subtitles, damage indicators.

### Controls
WASD move · Shift sprint · Space jump · C crouch · Q/E lean · LMB fire · RMB aim · R reload ·
1/2/wheel swap · B fire mode · V melee · G frag · H medkit · F interact (hold) · T light ·
N night vision · X blink · I inspect · Esc pause.

## Code layout
```
engine/            ShapeForge engine (+ game extensions: point/spot lights, spot-light shadows,
                   canvas textures, world-space patterns, storm sky, view-model pass, post FX)
src/content/       weapons, view model (arms rig + runtime animator), humans, props, textures
src/world/         level builder (both areas), physics (AABB world, movement, raycasts, nav A*)
src/game/          game glue, player, actors (squad, Class-D, SCP-173), director (story),
                   effects, audio, HUD
tools/dev.html     model/animation inspection harness; tools/shots.cjs headless screenshots
```

Debug URL flags: `?auto=a1|a2|173&nolock` jumps straight into an area, `&fps` shows frame stats.

## Testing
- `npm test` — Node smoke tests (weapon models, clips, aim rig, physics, nav).
- `?auto=a1&nolock&god=1&sim=75&fire=1&pilot=1&pos=[0,0,-14]` — headless logic run: a bot plays
  the whole demo (clear yard → terminal → defend → elevator → power → SCP-173 → complete) and
  logs `SIM {...}` to the console.
