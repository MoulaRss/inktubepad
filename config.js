// InkTube front-end config.
// InkTube v2.1 (propriétaire 0x364f4C067450137dFf69c193c2cb2A9cF31d3Ab8). Anciennes factories v1 / v2 retirées (0 frais à récupérer).
// Après `forge script script/Deploy.s.sol ...`, coller l'adresse + le bloc de déploiement ici.
window.INKTUBE_CONFIG = {
  LAUNCHPAD_ADDRESS: "",
  DEPLOY_BLOCK: 0,

  // InkTubeLaunchpadV2 (Premiere, anti-snipe, market cap tiers, vesting, fee split).
  // Vide = mode v1 uniquement. Une fois `forge script script/DeployV2.s.sol ...` passé, coller
  // l'adresse du launchpad v2 + son bloc : les nouveaux lancements passent par v2, les tokens v1
  // restent affichés et se tradent toujours sur le v1.
  LAUNCHPAD_V2: "0x9b6176DF81926714BE01bB958b01Bdbe2111617A",
  DEPLOY_BLOCK_V2: 58679556,

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
