// Rewarded-ad abstraction. Swap `showRewardedAd` with a real SDK call later
// (AdSense H5, GameMonetize, AdinPlay...) keeping the same Promise contract.

export interface AdProvider {
  show(onTick: (secondsLeft: number) => void): Promise<boolean>;
}

export const simulatedAdProvider: AdProvider = {
  show(onTick) {
    return new Promise((resolve) => {
      let left = 15;
      onTick(left);
      const iv = setInterval(() => {
        left -= 1;
        onTick(left);
        if (left <= 0) {
          clearInterval(iv);
          resolve(true);
        }
      }, 1000);
    });
  },
};

let provider: AdProvider = simulatedAdProvider;
export function setAdProvider(p: AdProvider) {
  provider = p;
}
export function showRewardedAd(onTick: (s: number) => void) {
  return provider.show(onTick);
}
export const AD_COIN_REWARD = 500;
