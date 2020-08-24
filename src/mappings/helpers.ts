/* eslint-disable prefer-const */
import { Address, BigDecimal, BigInt, log, EthereumEvent } from '@graphprotocol/graph-ts'
import { ERC20 } from '../types/Factory/ERC20'
import { ERC20 as ERC20Telmplate } from '../types/templates/Pair/ERC20'
import { ERC20SymbolBytes } from '../types/Factory/ERC20SymbolBytes'
import { ERC20NameBytes } from '../types/Factory/ERC20NameBytes'
import {
  Bundle,
  LiquidityPosition,
  LiquidityPositionSnapshot,
  MooniswapFactory,
  Pair,
  Token,
  User
} from '../types/schema'
import { Factory as FactoryContract } from '../types/templates/Pair/Factory'
import { findEthPerToken, getEthPriceInUSD, getTrackedLiquidityUSD } from './pricing'

export const ADDRESS_ZERO = '0x0000000000000000000000000000000000000000'
export let ETH_ADDRESS = ADDRESS_ZERO
export const FACTORY_ADDRESS = '0x71CD6666064C3A1354a3B4dca5fA1E2D3ee7D303'
export const ETH_BALANCE_CONTRACT = '0x42f527F50F16A103b6ccAb48BcCca214500c1021'

export let ZERO_BI = BigInt.fromI32(0)
export let ONE_BI = BigInt.fromI32(1)
export let ZERO_BD = BigDecimal.fromString('0')
export let ONE_BD = BigDecimal.fromString('1')
export let BI_18 = BigInt.fromI32(18)
export let EXP_18 = BigInt.fromI32(10).pow(18)
let fee = (BigInt.fromI32(10).pow(15)).times(BigInt.fromI32(3))

export let factoryContract = FactoryContract.bind(Address.fromString(FACTORY_ADDRESS))

export function exponentToBigDecimal(decimals: BigInt): BigDecimal {
  let bd = BigDecimal.fromString('1')
  for (let i = ZERO_BI; i.lt(decimals as BigInt); i = i.plus(ONE_BI)) {
    bd = bd.times(BigDecimal.fromString('10'))
  }
  return bd
}

export function bigDecimalExp18(): BigDecimal {
  return BigDecimal.fromString('1000000000000000000')
}

export function convertTokenToDecimal(tokenAmount: BigInt, exchangeDecimals: BigInt): BigDecimal {
  if (exchangeDecimals == ZERO_BI) {
    return tokenAmount.toBigDecimal()
  }
  return tokenAmount.toBigDecimal().div(exponentToBigDecimal(exchangeDecimals))
}

export function equalToZero(value: BigDecimal): boolean {
  const formattedVal = parseFloat(value.toString())
  const zero = parseFloat(ZERO_BD.toString())
  if (zero == formattedVal) {
    return true
  }
  return false
}

export function isNullEthValue(value: string): boolean {
  return value == '0x0000000000000000000000000000000000000000000000000000000000000001'
}

export function fetchTokenSymbol(tokenAddress: Address): string {
  // hard coded override
  if (tokenAddress.toHexString() == ETH_ADDRESS) {
    return 'ETH'
  }
  if (tokenAddress.toHexString() == '0xe0b7927c4af23765cb51314a0e0521a9645f0e2a') {
    return 'DGD'
  }

  let contract = ERC20.bind(tokenAddress)
  let contractSymbolBytes = ERC20SymbolBytes.bind(tokenAddress)

  // try types string and bytes32 for symbol
  let symbolValue = 'unknown'
  let symbolResult = contract.try_symbol()
  if (symbolResult.reverted) {
    let symbolResultBytes = contractSymbolBytes.try_symbol()
    if (!symbolResultBytes.reverted) {
      // for broken pairs that have no symbol function exposed
      if (!isNullEthValue(symbolResultBytes.value.toHexString())) {
        symbolValue = symbolResultBytes.value.toString()
      }
    }
  } else {
    symbolValue = symbolResult.value
  }

  return symbolValue
}

export function fetchTokenName(tokenAddress: Address): string {
  // hard coded override
  if (tokenAddress.toHexString() == ETH_ADDRESS) {
    return 'Ethereum'
  }
  if (tokenAddress.toHexString() == '0xe0b7927c4af23765cb51314a0e0521a9645f0e2a') {
    return 'DGD'
  }

  let contract = ERC20.bind(tokenAddress)
  let contractNameBytes = ERC20NameBytes.bind(tokenAddress)

  // try types string and bytes32 for name
  let nameValue = 'unknown'
  let nameResult = contract.try_name()
  if (nameResult.reverted) {
    let nameResultBytes = contractNameBytes.try_name()
    if (!nameResultBytes.reverted) {
      // for broken exchanges that have no name function exposed
      if (!isNullEthValue(nameResultBytes.value.toHexString())) {
        nameValue = nameResultBytes.value.toString()
      }
    }
  } else {
    nameValue = nameResult.value
  }

  return nameValue
}

export function fetchTokenTotalSupply(tokenAddress: Address): BigInt {
  let contract = ERC20.bind(tokenAddress)
  let totalSupplyValue = null
  let totalSupplyResult = contract.try_totalSupply()
  if (!totalSupplyResult.reverted) {
    totalSupplyValue = totalSupplyResult as i32
  }
  return BigInt.fromI32(totalSupplyValue as i32)
}

export function fetchTokenDecimals(tokenAddress: Address): BigInt {
  if (tokenAddress.toHexString() == ETH_ADDRESS) {
    return BigInt.fromI32(18)
  }
  let contract = ERC20.bind(tokenAddress)
  // try types uint8 for decimals
  let decimalValue = null
  let decimalResult = contract.try_decimals()
  if (!decimalResult.reverted) {
    decimalValue = decimalResult.value
  }
  return BigInt.fromI32(decimalValue as i32)
}

export function createLiquidityPosition(exchange: Address, user: Address): LiquidityPosition {
  let id = exchange
    .toHexString()
    .concat('-')
    .concat(user.toHexString())
  let liquidityTokenBalance = LiquidityPosition.load(id)
  if (liquidityTokenBalance === null) {
    let pair = Pair.load(exchange.toHexString())
    pair.liquidityProviderCount = pair.liquidityProviderCount.plus(ONE_BI)
    liquidityTokenBalance = new LiquidityPosition(id)
    liquidityTokenBalance.liquidityTokenBalance = ZERO_BD
    liquidityTokenBalance.pair = exchange.toHexString()
    liquidityTokenBalance.user = user.toHexString()
    liquidityTokenBalance.historicalSnapshots = []
    liquidityTokenBalance.save()
  }
  if (liquidityTokenBalance == null) log.error('LiquidityTokenBalance is null', [id])
  return liquidityTokenBalance as LiquidityPosition
}

export function createLiquiditySnapshot(position: LiquidityPosition, event: EthereumEvent): void {
  let timestamp = event.block.timestamp.toI32()
  let bundle = Bundle.load('1')
  let pair = Pair.load(position.pair)
  let token0 = Token.load(pair.token0)
  let token1 = Token.load(pair.token1)

  // create new snapshot
  let snapshot = new LiquidityPositionSnapshot(position.id.concat(timestamp.toString()))
  snapshot.timestamp = timestamp
  snapshot.block = event.block.number.toI32()
  snapshot.user = position.user
  snapshot.pair = position.pair
  snapshot.token0PriceUSD = token0.derivedETH.times(bundle.ethPrice)
  snapshot.token1PriceUSD = token1.derivedETH.times(bundle.ethPrice)
  snapshot.reserve0 = pair.reserve0
  snapshot.reserve1 = pair.reserve1
  snapshot.reserveUSD = pair.reserveUSD
  snapshot.liquidityTokenTotalSupply = pair.totalSupply
  snapshot.liquidityTokenBalance = position.liquidityTokenBalance
  snapshot.save()

  // add snapshot to lqiudiity position array
  let snapshots = position.historicalSnapshots
  snapshots.push(snapshot.id)
  position.historicalSnapshots = snapshots
  position.save()
}

export function createUser(address: Address): void {
  let user = User.load(address.toHexString())
  if (user === null) {
    user = new User(address.toHexString())
    user.usdSwapped = ZERO_BD
    user.save()
  }
}

export function fetchReserves(pairAddress: string): Array<BigInt> {
  let pair = Pair.load(pairAddress)
  let token0 = pair.token0 == ETH_ADDRESS ? Address.fromString(ETH_BALANCE_CONTRACT) : Address.fromString(pair.token0)
  let token1 = pair.token1 == ETH_ADDRESS ? Address.fromString(ETH_BALANCE_CONTRACT) : Address.fromString(pair.token1)
  let contract0 = ERC20Telmplate.bind(token0)
  let contract1 = ERC20Telmplate.bind(token1)
  let reserve0 = contract0.try_balanceOf(Address.fromString(pair.id))
  let reserve1 = contract1.try_balanceOf(Address.fromString(pair.id))
  return [reserve0.value, reserve1.value]
}

// export function fetchVirtualReserves(pairAddress: string, srcToken: string, dstToken: string): Array<BigInt> {
//   let contract = PairContract.bind(Address.fromString(pairAddress))
//   let srcAddition = contract.try_getBalanceForAddition(Address.fromString(srcToken))
//   let destRemoval = contract.try_getBalanceForAddition(Address.fromString(dstToken))
//   return [srcAddition.value, destRemoval.value]
// }

export function handleSync(pairAddress: Address): void {
  let pair = Pair.load(pairAddress.toHex())
  let token0 = Token.load(pair.token0)
  let token1 = Token.load(pair.token1)
  let mooniswap = MooniswapFactory.load(FACTORY_ADDRESS)
  let reserves = fetchReserves(pair.id)

  // reset factory liquidity by subtracting only tracked liquidity
  mooniswap.totalLiquidityETH = mooniswap.totalLiquidityETH.minus(pair.trackedReserveETH as BigDecimal)

  // reset token total liquidity amounts
  token0.totalLiquidity = token0.totalLiquidity.minus(pair.reserve0)
  token1.totalLiquidity = token1.totalLiquidity.minus(pair.reserve1)

  pair.reserve0 = convertTokenToDecimal(reserves[0], token0.decimals)
  pair.reserve1 = convertTokenToDecimal(reserves[1], token1.decimals)
  if (pair.reserve1.notEqual(ZERO_BD))
    pair.token0Price = pair.reserve0.div(pair.reserve1)
  else
    pair.token0Price = ZERO_BD
  if (pair.reserve0.notEqual(ZERO_BD))
    pair.token1Price = pair.reserve1.div(pair.reserve0)
  else
    pair.token1Price = ZERO_BD
  pair.save()

  // update ETH price now that reserves could have changed
  let bundle = Bundle.load('1')
  bundle.ethPrice = getEthPriceInUSD()
  bundle.save()

  token0.derivedETH = findEthPerToken(token0 as Token)
  token1.derivedETH = findEthPerToken(token1 as Token)
  token0.save()
  token1.save()

  // get tracked liquidity - will be 0 if neither is in whitelist
  let trackedLiquidityETH: BigDecimal
  if (bundle.ethPrice.notEqual(ZERO_BD)) {
    trackedLiquidityETH = getTrackedLiquidityUSD(pair.reserve0, token0 as Token, pair.reserve1, token1 as Token).div(
      bundle.ethPrice
    )
  } else {
    trackedLiquidityETH = ZERO_BD
  }

  // use derived amounts within pair
  pair.trackedReserveETH = trackedLiquidityETH
  pair.reserveETH = pair.reserve0
    .times(token0.derivedETH as BigDecimal)
    .plus(pair.reserve1.times(token1.derivedETH as BigDecimal))
  pair.reserveUSD = pair.reserveETH.times(bundle.ethPrice)

  // use tracked amounts globally
  mooniswap.totalLiquidityETH = mooniswap.totalLiquidityETH.plus(trackedLiquidityETH)
  mooniswap.totalLiquidityUSD = mooniswap.totalLiquidityETH.times(bundle.ethPrice)

  // now correctly set liquidity amounts for each token
  token0.totalLiquidity = token0.totalLiquidity.plus(pair.reserve0)
  token1.totalLiquidity = token1.totalLiquidity.plus(pair.reserve1)

  // save entities
  pair.save()
  mooniswap.save()
}

export function calculateFormula(balA: BigInt, balB: BigInt, amount: BigInt): BigInt {
  let taxedAmount = amount.minus(amount.times(fee).div(EXP_18))
  return taxedAmount.times(balB).div(balA.plus(taxedAmount))
}

export function sqrtBN(val: BigInt): BigInt {

  let z = ZERO_BI

  if (val.gt(BigInt.fromI32(3))) {
    z = val
    let x = val.div(BigInt.fromI32(2)).plus(BigInt.fromI32(1))
    while (x.lt(z)) {
      z = x
      x = (val.div(x).plus(x)).div(BigInt.fromI32(2))
    }
  } else if (!val.isZero()) {
    z = BigInt.fromI32(1)
  }

  return z
}
