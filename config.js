// InkTube front-end config.
// InkTube v2.1 (propriétaire 0xd4487b37C03a1b032622596c2A45B3e27e10b4ce, déployé le 17/10/2026). Anciennes factories retirées du site.
// Après `forge script script/Deploy.s.sol ...`, coller l'adresse + le bloc de déploiement ici.
window.INKTUBE_CONFIG = {
  LAUNCHPAD_ADDRESS: "",
  DEPLOY_BLOCK: 0,

  // InkTubeLaunchpadV2 (Premiere, anti-snipe, market cap tiers, vesting, fee split).
  // Vide = mode v1 uniquement. Une fois `forge script script/DeployV2.s.sol ...` passé, coller
  // l'adresse du launchpad v2 + son bloc : les nouveaux lancements passent par v2, les tokens v1
  // restent affichés et se tradent toujours sur le v1.
  LAUNCHPAD_V2: "0x38ea1Db0bCd2Df8Ac917459617d7E71382c8e6Ed",
  DEPLOY_BLOCK_V2: 58690223,

  CHAIN_ID: 57073,
  CHAIN_NAME: "Ink",
  RPC_URL: "https://rpc-gel.inkonchain.com",
  EXPLORER: "https://explorer.inkonchain.com",

  // Taille des tranches pour eth_getLogs : rpc-gel.inkonchain.com refuse plus de 1000 blocs par requête.
  LOG_CHUNK: 1000,
  POLL_MS: 6000,
  DEFAULT_SLIPPAGE_BPS: 500,
  IPFS_GATEWAY: "https://ipfs.io/ipfs/",

  // Remplissage temporaire : tant qu'il y a moins de TARGET tokens InkTube, l'accueil est
  // complété avec les tokens tendance d'Ink (source GeckoTerminal). Chaque lancement InkTube
  // prend la place d'un token externe. Mettre ENABLED: false pour couper.
  BACKFILL: {
    ENABLED: true,
    TARGET: 12,
    NETWORK: "ink",
    MAX_FDV_USD: 150000000,
    EXCLUDE: [], // tickers à ne jamais afficher, ex. ["SCAM"]
  },
};
