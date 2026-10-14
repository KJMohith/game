# Neon Survival

Create a polished HTML5 browser game inspired by 20 Minutes Till Dawn, using only HTML, CSS, and JavaScript (Canvas API). The game should run smoothly on desktop and mobile without external frameworks.

Core Gameplay

Top-down survival shooter.

Player moves with WASD (desktop) or virtual joystick (mobile).

Auto-fire at the nearest zombie.

Endless waves of zombies that become stronger over time.

Different zombie types:

Normal

Fast

Tank

Exploding

Boss every 5 minutes

Zombies drop coins when killed.

Currency System

Every zombie has a chance to drop coins.

Coins are automatically collected when the player walks near them.

Display total coins during gameplay.

Coins persist using localStorage.

Upgrade System

Open an upgrade menu:

After every level-up.

Also from the main menu.

Permanent upgrades purchasable with coins:

+10% Damage

+10% Fire Rate

+10% Movement Speed

+10% Max HP

+10% Bullet Speed

+5% Critical Chance

+10% Coin Magnet

Unlock new weapons

Each upgrade:

Has 20 levels.

Cost increases exponentially.

Saved permanently using localStorage.

Rewarded Ads (Simulation)

Include a "Watch Ad" button. Since this is a web demo, simulate a rewarded ad by:

Showing a 15-second countdown modal.

Disable skipping.

After countdown:

Reward player with 500 coins OR

Give one free revive if in-game.

Structure the code so it can later be replaced with a real rewarded ad SDK (Google AdSense, AdinPlay, GameMonetize, etc.).

Weapons

Pistol

Shotgun

SMG

Laser

Rocket Launcher

Lightning Staff

Each weapon has:

Damage

Fire rate

Projectile speed

Spread

Upgrade scaling

Player Progression

Gain XP from kills. Level up and choose one of three random upgrades:

Ricochet

Multi-shot

Bigger bullets

Burn damage

Freeze

Poison

Explosion on kill

Lifesteal

Faster reload

Drone companion

UI

Display:

HP bar

XP bar

Coins

Survival timer

Current wave

FPS counter

Pause button

Menus

Main Menu

Play

Permanent Upgrades

Weapon Selection

Settings

Statistics

Visual Style

Dark neon theme.

Smooth particle effects.

Bullet trails.

Zombie death animations.

Floating damage numbers.

Screen shake on explosions.

Responsive UI for mobile and desktop.

Audio

Include placeholders for:

Shooting

Zombie hit

Zombie death

Level up

Coin pickup

Boss spawn

Code Requirements

Well-structured with ES6 classes.

Separate modules for:

Player

Zombies

Weapons

Bullets

Coins

Upgrades

UI

Save System

Use delta-time for frame-independent gameplay.

Maintain 60 FPS performance with object pooling.

Save all progress using localStorage.

Optional Features

Daily rewards.

Achievement system.

Prestige mode.

Endless leaderboard (mock/local).

Mobile vibration support.

Full-screen mode.

PWA support for installation.

Easy integration of real rewarded ads and analytics later.

Must be easy to render and quick to run

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/08794728-d49f-4a18-8611-7a39bb682f68).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
