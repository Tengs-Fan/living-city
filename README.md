# Living City

An open-world city that remembers.

Open-world crowds are extras: created near the player, given a few minutes of behaviour, deleted when the player looks away.
Follow one for hours and the illusion breaks, because nobody has a home to go back to.
Kill one and the world forgets as soon as the body is cleared.

This project builds the opposite: every person on the street is a resident with a home, a job, a household and a day that ends somewhere, and what the player does to them is still felt a hundred hours later, by specific people and by whole districts.

- [docs/design.md](docs/design.md): the design, with prior art, the seven layers, budget and milestones.
- `src/`: a game-free prototype of the first four milestones, as a JavaScript library with no dependencies.
- `viewer/`: a 2D map of the city for looking at it.

Status: milestones M0 to M3 of the design work in the prototype.
M4, the port to a real engine, is not started.

## The example it was built to deliver

Nobody in this run is scripted.
The guard and her mother came out of the census, and the scene is a template the director filled in.

Output of `node bin/living-city.js story`, shortened and re-wrapped:

```
#4414 Ximena Ibarra, 33, worker: security guard at Coastal Trust, 08:00 to 17:00
  lives at 3133 Dalton Street, Fairmount
  mother Willa Ibarra

day 7 09:40    Ximena Ibarra, 33, a security guard at Coastal Trust, is killed at Coastal Trust (bank robbery); 12 saw it
day 7 09:51    The police know who was behind the killing at Coastal Trust
day 7 15:25    Willa Ibarra learns that her daughter Ximena is dead
day 8 07:00    News: Ximena Ibarra, 33, a security guard at Coastal Trust, was shot dead during a bank robbery
               at Coastal Trust on Mercer Street. She lived in Fairmount with her mother. Police have named a suspect.
day 8 07:00    Willa Ibarra learns who killed Ximena
day 19 09:00   Willa Ibarra, 74, is evicted from the house at 3133 Dalton Street and is now living on the pavement outside it
day 125 10:01  Scene: Willa Ibarra stops the player on the pavement. "You. I know your face. My daughter Ximena was
               a security guard at Coastal Trust, on Mercer Street. She went to work and never came home. I lost the
               house on Dalton Street after she died. This pavement is where I live now."
```

Game day 7 is about hour 5 of play and day 125 is hour 100, at 48 real minutes to a game day.

## Try it

Node 20 or later.
The library and the tests need nothing installed.

```bash
npm test
```

```bash
node bin/living-city.js stats
```

```bash
node bin/living-city.js person "Willa Ibarra"
```

```bash
node bin/living-city.js corner 08:30
```

```bash
node bin/living-city.js rampage 2000
```

The viewer runs from any static file server, straight from the source:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080/viewer/`.
To get one file that opens from disk instead, `npm install` and `npm run bundle` write `dist/living-city.html`.

In the viewer every dot is a person who is outside right now.
Tap one to read their record and their day, and press Follow to tail them home.
The Story tab runs the robbery above one step at a time.

## What is built

The seven layers of the design, and where each lives:

| Layer | File | What it does |
| --- | --- | --- |
| The city | `src/city.js`, `src/routing.js` | A seeded city: 13 districts, about 7,600 buildings, each with a door on a street, and shortest routes between any two doors |
| 1. Census | `src/census.js` | About 47,000 residents in 23,000 households, with partners, parents, children and siblings, some across households; jobs by a distance-weighted choice; 17,000 commuters and 3,800 tourists from off the map |
| 2. Daily plans | `src/plans.js` | `plan(id, day)` as a pure function: a chain of stops with a place, a purpose and times, by archetype, weekday, habit and what has happened to the person |
| 3. Presence | `src/presence.js` | An index of who is on the street by five-minute bucket and map cell, and the 150 m ring that puts people online and offline |
| 4. Event memory | `src/memory.js` | Kills, woundings, robberies and gunfire become world events with witnesses and a salience; police, news and relatives come to know on a timeline |
| 5. Consequences | `src/consequences.js` | Rules: grief, lost income and eviction, fear, arming, revenge, moving away, recovery |
| 6. District mood | `src/mood.js` | Fear, violence, policing and prosperity per district, rising and fading, and what they do to the street |
| 7. Director | `src/director.js` | Keeps the few most salient pending payoffs and plays one as a scene when its person is beside the player |
| The world | `src/world.js` | Ties it together: `whereIs`, `near`, `advance`, `save`, `loadWorld` |

Using it:

```js
import { createWorld, loadWorld, DAY } from './src/world.js';

const w = createWorld({ seed: 1 });
w.whereIs(4414, 9 * 60);        // where is this person at 09:00 on day 0
w.plan(4414, 3);                // her whole Thursday
w.near(x, y, 150);              // who is on the street within 150 m, right now
w.act.kill(4414);               // the host game reports what the player did
const scene = w.advance(5);     // five game minutes pass; the director may return a scene
w.advance(30 * DAY, { player: false }); // a month the player does not live through
const copy = loadWorld(w.save());       // a save holds only what play changed
```

## Measured

On one core of a cloud container, with the default city of 67,800 people:

| | |
| --- | --- |
| Generate the city and the census | 0.3 s |
| Plan a day for everyone | 0.5 s the first time, 0.13 s after |
| `whereIs` for one person | 0.2 microseconds from the day's table, 2 microseconds from scratch |
| Who is within 150 m of a street corner | 60 microseconds |
| Let 120 game days pass with nobody watching | 2 ms |
| Census in memory | 39 bytes a person |
| Save after the story above | 3.7 KB |
| Save after 2,000 killings in 156 game days | 600 KB |

Nothing runs for people nobody is near.
A skipped month costs only the consequences that fall due in it.

## Where it departs from the design

- **A generated city, not OpenStreetMap.**
  The design lists this as an open question.
  A generated grid got to the consequence chain sooner, and everything downstream only needs buildings with doors on a street graph, so a real map can replace `src/city.js`.
- **Visitors are stored, not lazy.**
  The design generates commuters and tourists on demand.
  At this size it is simpler to keep them in the same arrays; they have no household, so no family on the map.
- **No deviation.**
  People follow their plans exactly.
  Blocking someone's car or scaring them off their route, and the rejoin afterwards, is the hard part of presence and is not attempted.
- **Indoors is one place.**
  A killing inside a building is seen by the staff and residents who are in it; customers are not tracked.
- **Reactions are flags.**
  A witness who would flee, or stand and fight, is marked as such in the ring.
  Acting it out belongs to the host game.
- **The population only shrinks.**
  Nobody moves into an emptied home, so a very long, very violent game drains the city.
  The design leaves births and newcomers out of the first version; recovery of people is limited to moods, forgotten faces and the homeless finding a hostel.
- **One scene template for each payoff.**
  Confrontation and revenge, in text.

## Next

- Deviation and rejoin for people who are online.
- Newcomers, so that districts refill as well as recover.
- More rules and scene templates, and a pass on tone.
- M4: replace the crowd spawner of Unreal Engine 5's City Sample with `near`, and report its events through `act`.
