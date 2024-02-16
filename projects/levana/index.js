const { queryContract, sumTokens } = require('../helper/chain/cosmos')
const { transformBalances } = require('../helper/portedTokens')

async function tvl(_, _b, _cb, { api, debugComputeTvl }) {
  const { chain } = api
  const { factory } = config[chain]
  // Get a list of marketIds from the factory contract
  // Iterate over the markets and request the balance of each market's collateral token
  const markets = await getMarketIds(chain, factory)
    .then(marketIds =>
      Promise.all(marketIds.map(id => getMarketAddr(chain, factory, id).then(addr => ({id, addr}))))
    )
    .then(marketList => marketList.reduce((acc, {id, addr}) => {
      acc[id] = addr
      return acc
    }, {}))

  const reverseMarketLookup = Object.entries(markets).reduce((acc, [id, addr]) => {
    acc[addr] = id
    return acc
  }, {})

  const marketDenomLookup = {}

  const debugCollateralBalance = {
    byMarket: {},
    byDenom: {}
  }


  const onDebugBalance = ({ block, owner, denomKey, amount, }) => {
    const marketId = reverseMarketLookup[owner]
    if(marketDenomLookup[marketId] !== undefined) {
      throw new Error("multiple denoms per market are not supported");
    }
    marketDenomLookup[marketId] = denomKey

    if (debugCollateralBalance.byMarket[marketId] === undefined) {
      debugCollateralBalance.byMarket[marketId] = 0
    }
    if(debugCollateralBalance.byDenom[denomKey] === undefined) {
      debugCollateralBalance.byDenom[denomKey] = 0
    }

    debugCollateralBalance.byMarket[marketId] += Number(amount)
    debugCollateralBalance.byDenom[denomKey] += Number(amount)
  }

  const res = await sumTokens({ chain, owners: Object.values(markets), onDebugBalance});

  console.log(`----[${chain}] COLLATERAL BALANCE DEBUG----`)
  console.log(debugCollateralBalance.byMarket)

  const debugUsdTvlPerMarket = {
  }
  for(const [marketId, collateralBalance] of Object.entries(debugCollateralBalance.byMarket)) {
    const denomKey = marketDenomLookup[marketId]

    const balances = await transformBalances(chain, {
      [denomKey]: collateralBalance.toString()
    })

    if(Object.values(balances)[0] !== collateralBalance.toString()) {
      throw new Error(`transformBalances returned a different balance than the input: ${Object.values(balances)[0]} vs. ${collateralBalance.toString()}`)
    }

    const debugTvl = await debugComputeTvl(balances)

    debugUsdTvlPerMarket[marketId] = debugTvl.usdTvl
  }
  
  console.log(`----[${chain}] USD BALANCE DEBUG----`)
  console.log(debugUsdTvlPerMarket)

  for(const [marketId, usdTvl] of Object.entries(debugUsdTvlPerMarket)) {
    if(usdTvl === 0) {
      const denomKey = marketDenomLookup[marketId]
      console.log(`On ${chain} chain, ${marketId} has 0 USD TVL, collateral balance is ${debugCollateralBalance.byMarket[marketId]}, denom is ${denomKey}`)
    }
  }

  return res;
}

async function getMarketIds(chain, factory) {
    const market_ids = [];

    // eslint-disable-next-line no-constant-condition
    while(true) {
      const resp = await queryContract({
        contract: factory,
        chain: chain,
        data: { markets: {
          start_after: market_ids.length ? market_ids[market_ids.length - 1] : undefined,
        } }
      });

      if(!resp || !resp.markets) {
        throw new Error(`could not get markets on chain ${chain}`);
      }
        
      if(!resp.markets.length) {
          break;
      }

      market_ids.push(...resp.markets);
    } 

    return market_ids 
}

async function getMarketAddr(chain, factory, marketId) {
  const marketInfo = await queryContract({
    contract: factory,
    chain: chain,
    data: { market_info: { market_id: marketId } }
  });

  return marketInfo.market_addr;
}

module.exports = {
  timetravel: false,
  methodology: "TVL is the sum of deposits into the Liquidity pools combined with the sum of trader collateral for open and pending positions",
}

const config = {
  osmosis: { factory: 'osmo1ssw6x553kzqher0earlkwlxasfm2stnl3ms3ma2zz4tnajxyyaaqlucd45' },
  sei: { factory: 'sei18rdj3asllguwr6lnyu2sw8p8nut0shuj3sme27ndvvw4gakjnjqqper95h' },
  injective: { factory: 'inj1vdu3s39dl8t5l88tyqwuhzklsx9587adv8cnn9' },
}


for(const chain of Object.keys(config)) {
  module.exports[chain] = { tvl }
}
