# The living city: residents, memory and consequences

Status: design proposal, November 2026.
Nothing here is built yet.
It is written for a GTA-style open-world game and assumes no particular engine or codebase.

Open-world cities already look busy.
This page is about making one *remember*.
The goal is a city where the people you meet have lives that hang together over a whole day, and where what you do to them is still felt dozens of hours later.

The example this design is built to deliver:

> At hour 5 you rob a bank and shoot a guard called Jason.
> At hour 100 a woman sleeping on a pavement stops you, says her son's name, and tells you he was a guard at that bank.
> She lost her flat after he died.
> She was never a scripted character: she was his mother in the census from the first minute of the game.

And at the scale of the whole city: kill enough people in one district and its residents start carrying guns, its shops shut early, and its streets empty at night, until time and better behaviour bring it back.

## Contents

- [Why the street feels shallow](#why-the-street-feels-shallow)
- [Goals and non-goals](#goals-and-non-goals)
- [What other games and fields have done](#what-other-games-and-fields-have-done)
- [Overview: seven layers](#overview-seven-layers)
- [1. The census](#1-the-census)
- [2. Daily plans](#2-daily-plans)
- [3. Presence: who is on the street right now](#3-presence-who-is-on-the-street-right-now)
- [4. Event memory](#4-event-memory)
- [5. Consequences for people](#5-consequences-for-people)
- [6. Consequences for places: district mood](#6-consequences-for-places-district-mood)
- [7. The director](#7-the-director)
- [Fitting it into a game](#fitting-it-into-a-game)
- [Budget](#budget)
- [Milestones](#milestones)
- [Risks and open questions](#risks-and-open-questions)
- [References](#references)

## Why the street feels shallow

In a typical open-world city, everybody on the pavement is an extra who exists for as long as the player is near.

- The crowd system keeps a few dozen to a few hundred people in a ring round the player.
- Each one is created out of view with a random appearance and a short task: "walk somewhere", "drive around".
- He is deleted once the player is far enough away or looking elsewhere, usually within minutes.

So a person has no home, no job and no tomorrow.
Players who tail one find this out: a woman leaves an office, walks for an hour, gets into a car and drives round the city for ten hours without ever arriving anywhere.
That is the "drive around" task running far longer than it was designed for, because the deletion it relied on never came.

The same games remember a great deal about the *player* (wanted level, money, mission progress, property) and almost nothing about the people he meets.
Kill someone and he is forgotten when the body is cleared.

## Goals and non-goals

Goals:

1. **Everyone you meet is someone.**
   A person on the street has a home, a job or a reason to be out, a household, and a plan for the day that ends somewhere.
2. **Actions leave marks that last.**
   Deaths, robberies, carjackings and shoot-outs change specific people and whole districts, for game weeks and months.
3. **Consequences are seen and recognised.**
   A payoff only works if the player connects it to what he did; most consequences stay quiet, a few are shown on purpose.
4. **Consequences are not a punishment.**
   A violent game is a different city, not a worse game (the lesson of Dishonored's chaos system, below).
5. **It costs nothing you can measure.**
   No change to the frame-rate target, a small addition to the save.

Not in the first version:

- Multiplayer.
- Language-model dialogue at runtime.
- Building interiors: people go "inside" by reaching a door and leaving the world.
- Children, births, ageing: the population is fixed apart from what the player does to it.

## What other games and fields have done

| Where | What it does | Lesson for us |
| --- | --- | --- |
| S.T.A.L.K.E.R.'s A-Life (2007) | NPCs within about 150 m of the player are simulated in full ("online"); everyone else runs a cheap "offline" version. Its developers call offline behaviour the level of detail of online. | Detail by distance is the core idea. The sequel launched without the original's full offline persistence: it is hard to keep. |
| Oblivion's Radiant AI (2006) | NPCs have needs (hunger, sleep) and choose how to meet them. | It had to be toned down: NPCs killed each other for items. Free NPCs need rules. |
| Red Dead Redemption 2 (2018) | Some townsfolk keep a full daily routine: room at the saloon, a long walk to the farm, work, back for a drink. | Routines read as "alive" when a player follows someone. Done there for a handful of named people in small towns. |
| Watch Dogs: Legion (2020) | Its Census system generates every Londoner with an appearance, a life, a schedule and relationships, so any of them can be recruited. | The closest thing to this design at city scale; generated on demand rather than stored, and without long-term consequences. |
| Dishonored (2012) | Its hidden chaos level rises with killing: more rats, more plague victims, more guards, a darker ending. | District-wide consequences work. But reviewers felt it made a right and a wrong way to play. |
| Shadow of Mordor's Nemesis System (2014) | Enemy orcs remember fights with the player, come back scarred and rise in rank. | Personal memory is what players talk about years later. It is patented (see [Risks](#risks-and-open-questions)). |
| Cities: Skylines (2015) | Every citizen has a name, an age, a home and a workplace, but only about 65,000 move in the world at once; the rest are records. | Tracking hundreds of thousands of people is cheap if most of them are data. |
| MATSim (transport engineering) | Simulates millions of synthetic people (about 6 million for Switzerland), each with a full daily activity plan (home, work, shopping) on a real road network. | Synthetic populations and daily plans are a solved research problem: borrow the method. |
| Generative Agents ("Smallville", 2023) | 25 language-model agents plan days, remember, talk and organise a party. | Wonderful behaviour, but two days for 25 agents cost thousands of dollars in API calls: use it only for the few people the player talks to, if at all. |
| Unreal Engine 5 City Sample (2022) | 35,000 simulated pedestrians in a data-oriented crowd system (Mass AI). | Crowds of that size are a solved rendering and steering problem; the people are still extras. |

The pieces exist.
Nobody has combined a stored census, daily plans and long-term consequences at the scale and detail of a GTA.

## Overview: seven layers

```
census          who lives and works in the city (generated from a seed, never saved whole)
  └ daily plans   where each of them is meant to be at any minute (a pure function of id and time)
      └ presence    which of them are on the street round the player now (spawned from the plan)
event memory    what happened, to whom, who saw it (from the game's events)
  ├ consequences  rules that change people later: grief, lost income, eviction, fear, revenge
  ├ district mood fear, violence, policing and prosperity per district, rising and decaying
  └ director      chooses the few consequences worth showing, and when
```

The first three make people coherent.
The last four make the world remember.
Each layer is useful on its own: the census and plans alone fix "she never goes home".

## 1. The census

### How many people a game city needs

Far fewer than the real city, because game maps are heavily shrunk and the buildings have to house everyone.
The estimate is built-up land area times a realistic density.
The areas are fan measurements of the maps, so treat the results as order-of-magnitude.

| | Built-up area | Density used | Residents |
| --- | --- | --- | --- |
| GTA 5-scale city (Los Santos) | about 9 km² | 3,000 to 8,000 per km² | 30,000 to 70,000 |
| GTA 5-scale countryside towns | | | a few thousand |
| **GTA 5-scale total** | | | **35,000 to 75,000** |
| GTA 6-scale city (Vice City) | about 17 km² | 4,000 to 8,000 per km² | 65,000 to 130,000 |
| GTA 6-scale surrounding towns | said to be about 11 times GTA 5's | | 50,000 to 110,000 |
| **GTA 6-scale total** | | | **120,000 to 250,000** |

Real Los Angeles has about 3.9 million people and Miami-Dade County about 2.7 million.
The design target is therefore 50,000 to 250,000 residents.

### Residents and visitors

A game downtown, like a real one, holds many more jobs and hotel beds than the map has homes for.
So the census has two kinds of people.

- **Residents** are generated in full when the game starts: home, household, job, relationships.
- **Visitors** (commuters from off the map, hotel guests, tourists) are generated *lazily*: visitor number *k* of a workplace and shift is a pure function of the seed and *k*, with a home "out of town".
  A visitor becomes a stored person only when something happens to him that the game must remember (he is killed, robbed, carjacked, or witnesses a crime).
  From then on he is a resident in every way that matters, including a family generated on demand.

The rule that makes everything else possible: **every killable person comes from the census.**
A randomly spawned extra has no mother to cry for him.

### What a person is

A person is a small fixed record, 64 to 128 bytes, kept in flat arrays:

- `id`, `home` (building id, or off-map), `work` (building id, or none), `shift`
- `household` id, `archetype` (see [Daily plans](#2-daily-plans)), personality bits (brave, nervous, sociable, armed when afraid)
- `appearanceSeed`, so he has the same face, clothes and car every time he appears
- a name drawn from name tables
- state that changes in play: dead, injured, moved away, evicted, grieving, afraid, hostile to the player, and a `mood` value

Relationships come from the generator, not from play:

- a **household** (the people in one flat or house: couples, parents and grown children, flatmates);
- **family across households** (a grown son in one district whose mother lives in another);
- **workmates** (people sharing a workplace and shift);
- **gang membership** for some residents of gang territory.

The generator follows the synthetic-population method of transport modelling: draw households to fill the homes, then assign each working member a workplace by a distance-weighted choice, so most people work reasonably near where they live.

Because the whole census can be generated again from the seed, the save stores only what changed.

## 2. Daily plans

A plan is one person's day as a chain of activities with time windows, the way MATSim and Watch Dogs: Legion do it.

| Archetype | A typical weekday |
| --- | --- |
| Office worker | home until 08:00, travel, work downtown 09:00 to 17:30, sometimes a bar or the shops, home by 20:00 |
| Shop worker | open the shop at 09:00 or 12:00, eight hours, home |
| Night shift (hospital, docks, police) | sleep by day, work 22:00 to 06:00 |
| Retiree | short walks, the park, a café, home early |
| Student or unemployed | late start, wandering, the beach, the arcade |
| Gang member | sleeps late, hangs about the territory in the afternoon and night |
| Hotel guest or tourist | the beach, the pier, the sights, back to the hotel |
| Homeless (only through consequences) | a pavement spot by day, a doorway or a park bench by night |

Weekends and a hash of the id vary it ("Tuesday is gym day"), so two office workers never live the same day.

The key property: **`plan(id, day)` is a pure function**, and so is `whereIs(id, t)`, which returns the current activity, the building, and, between activities, the leg being travelled (a pavement path or a road route) and how far along it he is.
Nothing ticks for people nobody is near.
The game asks where someone is only when it needs to know.

Every outing in a plan has a destination and an end, which by itself fixes the person who drives round the city for ten hours.

**Time.**
The examples assume a game day of 48 real minutes, as GTA 5 uses, so 100 hours of play is 125 game days.
Every delay below is in game days.

## 3. Presence: who is on the street right now

Three levels of detail, by distance, after A-Life:

| Level | Where | Cost |
| --- | --- | --- |
| Offline | everyone not near the player | nothing: a record and a plan |
| Placed | nearby but out of sight; someone the crowd system is about to spawn | one `whereIs` call, then movement along the road graph |
| Online | within about 150 m: a full character with animation, steering and perception | what a pedestrian costs today |

**Spawning from the census.**
Where the crowd system picks a random point and a random extra today, it asks the census instead: *who is meant to be on the pavement or the road in this ring right now?*
It spawns one of those, at the point his plan has reached, with his appearance, and with a task that follows his current leg ("walk this path to this door").
That query needs an index: for each time bucket of the day, which residents are travelling through which cell of the map.
If nobody fits, it falls back to an anonymous visitor, who is still a reproducible person, so the street is never thinner than before.
Traffic does the same for drivers: a car on the road is someone driving to somewhere.

**Arriving.**
At his destination a person parks, walks to the building's door and leaves the world; the census marks him inside until his plan sends him out again.
A follower watches him park, walk up and go in.

**Leaving the world.**
When the crowd system removes an online person, his record keeps his state (hurt, afraid, carrying a gun now) and his plan resumes from the clock.
If the player comes back, the same person can reappear where his plan has taken him.

**Deviation.**
An online person who is delayed (the player blocks his car, a shoot-out sends him running) is off his plan.
When he goes offline he snaps back to it; while online he re-routes to the plan's next destination.
This is where visible popping would come from, and it is the hardest part of this layer.

**Mission characters.**
Missions keep spawning their own people, but they draw them from the census: the bank has a security staff, and the robbery mission uses two of them, real people with homes and mothers.
Mission behaviour does not change; only who the guards are.

## 4. Event memory

The memory listens to events any such game already produces: a character killed or hurt (and by whom), a carjacking, a robbery, an explosion, a fire, a witness calling the police, a mission ending.

Each becomes a **world event**: when, where (position and district), what, the people it happened to, and the people who saw it.
Witnesses are the online people within sight of it.

**Salience** scores how much an event is worth remembering in detail: a death counts more than an injury; a person with family more than a lone visitor; a crime somebody saw more than one nobody did; a mission's victim more than a passer-by.
High-salience events are kept in full.
Low-salience ones are folded into district counters after a few game days and forgotten as individual events.

**Who knows what.**
Knowledge spreads along a few channels, each with a delay:

- an eyewitness knows the player's face at once;
- the police know after a call or a sighting;
- the household and family of a victim know within a day that he died, and who did it once the police or a witness knows;
- a district knows about a big event (a bank robbery, a massacre) through the news within a day or two.

Knowledge is what lets the mother recognise the player 120 game days later.

## 5. Consequences for people

A consequence is a rule: a trigger, conditions, a delay, an effect on people's records, and optionally a scene.
Rules run once per game hour over the people an event touched, not over the whole census.

| Rule | Trigger and conditions | Effect |
| --- | --- | --- |
| Grief | a household member or relative was killed | grieving for a few game weeks: stays in more, stops going to work for a while, mood falls |
| Lost income | the household's only earner died | after about 14 game days, eviction: the household is split, an elder becomes homeless (archetype and plan change), the flat is free |
| Fear | witnessed a killing, or was robbed or carjacked | avoids the place, changes routes, flees at the sight of the player for a few game weeks |
| Armed | afraid and brave, in a district whose fear is high | carries a pistol, fights back instead of fleeing |
| Revenge | a brave relative of a victim, or the victim's gang | after a delay, looks for the player in the districts he frequents |
| Moving away | grief or fear high for long enough | the household leaves the city; its home stands empty |
| Recovery | time, and nothing new | moods drift back; an evicted person may find a hostel; a district's memory fades |

Rules are the limit Oblivion lacked: a person can only do what a rule allows, and important characters can be marked exempt.

### The bank guard, step by step

1. **Hour 5 (game day 6).**
   The player kills Jason, a guard, during the bank robbery.
   The world event stores the victim (census id), the place, the mission, and the eyewitnesses.
2. **Same game day.**
   Jason's mother, who shares his flat and relied on his pay, learns he died.
   Grief begins.
3. **Day 7.**
   The police know who robbed the bank, and through the news, so does she.
4. **About day 20.**
   Lost income fires: she is evicted.
   Her archetype becomes homeless, and her plan now has a pavement spot near her old building.
5. **Day 125 (hour 100).**
   The player walks past her spot.
   The director sees that she holds an unspent high-salience consequence, that she knows his face, and that enough time has passed.
   She stops him with a short scene: her son's name, the bank, what happened to her since.

Nothing in that chain is a cutscene written for that guard.
It is the census, a few rules, and one reusable scene template ("a victim's relative confronts the player") that any killing can fill in.

## 6. Consequences for places: district mood

Each district keeps four numbers from 0 to 1:

| Number | Rises with | Falls with (half-life) |
| --- | --- | --- |
| Fear | killings, gunfire, explosions, especially seen ones | about 20 game days |
| Violence | the player's and the gangs' kills and fights there | about 30 game days |
| Policing | the violence the police respond to | follows violence, a few days behind |
| Prosperity | falls with fear, evictions and empty homes | slow, about 60 game days |

What they change:

- the share of civilians who are armed and fight back;
- how many people are out at night;
- patrol density and police response time;
- how bold the local gang is;
- set dressing: shops shut early, shutters down, boarded windows, flowers and candles at a scene;
- what the radio news talks about.

These are four numbers per district, a few bytes in the save, and they deliver the "everyone on the street is armed now" half of the goal without any per-person work.

Dishonored's lesson applies: a high-fear district should be *interesting* (tense streets, armed civilians, empty plazas, more for a criminal to do), not just harder.
And the world must be able to recover, or a long game ends in a dead city, as Oblivion's towns slowly emptied.

## 7. The director

Most consequences stay quiet: an empty flat, a person who avoids you, a district on edge.
A few deserve a scene, and the director picks them, as Left 4 Dead's AI director paces a level.

It keeps a short list of **pending payoffs** (high-salience consequences not yet shown) and, every game hour, checks whether one can be shown now:

- the person is online, or his plan brings him near the player soon;
- enough time has passed since the event (days to months, depending on the rule);
- the player is not in a mission or a chase;
- no other personal scene has played in the last couple of real hours.

**Recognition.**
A payoff at hour 100 only lands if the player remembers hour 5.
The scene names the place and the person ("my son Jason was a guard at the bank on Fifth"), and the game plants the memory earlier: a news item the next day with his name and photo, flowers at the bank's door for a week.

**Not noise.**
A GTA player kills thousands of people in a long game.
If every one of them sent a crying relative, it would be tiresome within an hour.
Only a few deaths ever become scenes; the rest feed the district numbers.

## Fitting it into a game

The system is a library with no rendering in it.
It touches the host game in four places, which any open-world game has.

| Host system | What changes |
| --- | --- |
| Crowd and traffic spawning | ask the census who should be here instead of rolling a random extra; report back when someone is removed |
| Game events | publish deaths, injuries, robberies, carjackings and witness reports to the event memory |
| Save | store the census's changes, the world events, the district moods and the pending payoffs |
| Scene playback | let the director start a short scene from a template with names and places filled in |

Everything else (census, plans, rules, moods, director) is self-contained and can be built and tested without a game.

**Determinism.**
The census and the plans use their own seeded random generators, so the same seed always gives the same city of people, and a bug report can name a resident by id.

**Speech.**
A name invented by a generator cannot be spoken by a recorded actor.
The options, simplest first: the voice says "my son" and the subtitle carries the name; record the census's first-name pool once and splice the name into the line; or use synthesised speech for these scenes.

**Debug tools.**
Inspect any person (record, today's plan, what he knows), follow one with a free camera, list pending payoffs, fast-forward days.
Behaviour nobody scripted cannot be debugged without these, so they are part of the first milestone.

## Budget

**Memory.**
250,000 residents at 128 bytes is 32 MB; at GTA 5 scale, under 10 MB.
The presence index is of the same order.
Stored visitors and world events add a few megabytes in a long, violent game.

**Processor.**
Offline people cost nothing.
`whereIs` runs only when the crowd system spawns someone, a handful of times per second.
The rules and the moods run once per game hour over the people an event touched.
The whole system should stay well under 1% of one core.
What is expensive is what was always expensive: animating, steering and drawing the people near the player, and that does not change.

**Save.**
The census is never saved, only its changes.
A death is a few bytes; low-salience events fold into district counters and disappear as individual records.
A target of 1 MB for a 100-hour game is comfortable.

**Content.**
The real cost is not the computer's work but what a person can be seen *doing*: parking and walking to a door, sitting on a bench, sleeping in a doorway, a confrontation scene.
Each needs animation, voice and testing, and every home on the map needs a door and a parking spot that work.
The first version needs only a few such pieces.

## Milestones

| Step | What it delivers | How we know it works |
| --- | --- | --- |
| M0 | A game-free prototype: about 50,000 residents on a real city's street map from OpenStreetMap, with census, plans and `whereIs`, drawn as dots in 2D | pick any dot and read a believable day; pick a street corner at 08:30 and get the people passing it; census generation takes seconds, a spawn query microseconds |
| M1 | Presence in the prototype: a "player" point with a 150 m ring, people going online and offline as it moves | tail one resident for a game day and watch him reach his door; leave and return and find the same people where their plans put them |
| M2 | Event memory and district mood | kill people in the prototype; districts change and recover; save and load keep the changes |
| M3 | The first consequence chain and the director: the guard, his mother, the eviction, the confrontation | a scripted run kills a guard, skips 120 game days, walks past the spot and sees the scene trigger; a run with 2,000 kills triggers only a handful |
| M4 | Port to a real engine: Unreal Engine 5's City Sample, replacing its Mass AI crowd spawning with the census | a human follows someone home on screen; playtests answer whether consequences are noticed, moving, or annoying |

M0 and M1 alone already answer the complaint this started from.

## Risks and open questions

- **Noticed at all?**
  A Bethesda designer has said that the better Radiant AI got, the less players noticed it.
  The whole system is invisible unless the director and the recognition cues work, and that can only be judged in M4, late.
- **Consistency under deviation.**
  Switching between levels of detail without visible popping, and keeping a delayed person's plan believable, is where A-Life-style systems have struggled.
- **Destinations.**
  "Going home" needs a door, a parking spot and a believable disappearance at every home on a very large map.
- **Tone.**
  GTA-style games are satire.
  A grieving mother is not funny.
  The serious moments should be rare enough to earn their place.
- **The Nemesis patent.**
  Warner Bros' patent on the Nemesis System runs until August 2036.
  This design is about civilians, households and districts, not enemy hierarchies, but before anything here ships commercially the claims should be read and a lawyer asked.
  This is not legal advice.
- **Do visitors get families?**
  Generating them on demand is enough for a dead commuter's widow to exist; whether she can appear in the city when she lives off the map is a design choice.
- **Save growth.**
  Compaction must be tested on a very long, very violent run.
- **Is a real street map the right first step?**
  It gives realistic geometry for free, but the import is work that tests nothing about consequences.
  A generated grid city would get to M3 sooner.

## References

- S.T.A.L.K.E.R.: [Interview: Inside the AI of S.T.A.L.K.E.R.](https://www.gamedeveloper.com/pc/interview-inside-the-ai-of-i-s-t-a-l-k-e-r-i-) (Game Developer) and [A-Life: an insight into ambitious AI](https://gamedeveloper.com/design/a-life-an-insight-into-ambitious-ai)
- Oblivion: [Why Oblivion's NPC rampage matters](https://www.slashgear.com/1237314/why-oblivions-npc-rampage-matters-for-the-future-of-ai-development) (SlashGear), and Bruce Nesmith on Radiant AI becoming [less noticeable as it improved](https://frvr.com/blog/news/elder-scrolls-designer-explains-that-radiant-ai-is-an-enormous-investment-for-bethesda-but-every-improvement-actually-makes-it-less-noticeable-to-players/)
- Red Dead Redemption 2: [following NPCs for a game day](https://rockstarintel.com/?p=1075) (RockstarINTEL)
- Watch Dogs: Legion: [The tools that built London](https://news.ubisoft.com/en-us/article/4po3S9Pwp1YcgBmGPmQxAh/watch-dogs-legion-the-tools-that-built-london) (Ubisoft) and the GDC 2021 talk [Census: The Systemic Backbone Behind Play As Anyone](https://www.gdcvault.com/play/1027018/contactUs)
- Dishonored: [Giant Bomb on the chaos system](https://giantbomb.com/wiki/Games/Dishonored), and [Game Informer's review](https://www.Gameinformer.com/games/dishonored/b/pc/archive/2012/10/07/dishonoredreview.aspx) on its right and wrong way to play
- Nemesis System patent: [KitGuru](https://kitguru.net/gaming/matthew-wilson/warner-bros-nemesis-system-patent-wont-expire-until-2036) and [NME](https://www.nme.com/news/warner-bros-successfully-patented-shadow-of-mordor-nemesis-system-2874386)
- Cities: Skylines: [Dev diary 7: Simulation](https://admin-forum.paradoxplaza.com/forum/developer-diary/cities-skylines-dev-diary-7-simulation.828492/page-5) (Paradox) and [Cities: Skylines 2 has no cap on the people it tracks](https://pcgamer.com/cities-skylines-2-has-no-cap-on-the-number-of-people-it-can-track-and-its-basically-the-matrix) (PC Gamer)
- MATSim: [a large-scale scenario of Switzerland](https://research-collection.ethz.ch/bitstream/handle/20.500.11850/152027/eth-1445-01.pdf) (ETH Zürich) and the [Activity-based Transport model of Melbourne](https://arxiv.org/pdf/2112.12071)
- Generative Agents: [Park et al., 2023](https://arxiv.org/abs/2304.03442), and the cost discussed in [Affordable Generative Agents](https://arxiv.org/html/2402.02053v2)
- Unreal Engine 5: [City Sample](https://api.unrealengine.com/marketplace/en-US/product/city-sample) and [The Matrix Awakens stats](https://www.aol.com/news/inside-matrix-awakens-epic-games-040021751.html)
