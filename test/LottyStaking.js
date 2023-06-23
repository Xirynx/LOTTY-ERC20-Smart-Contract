const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture, setBalance, time } = require('@nomicfoundation/hardhat-network-helpers');

const { abi: uniswapV2PairABI } = require('../artifacts/@uniswap/v2-core/contracts/interfaces/IUniswapV2Pair.sol/IUniswapV2Pair.json');

describe('Lotty Staking', () => {
	const setupContracts = async () => {
		const lottyFactory = await ethers.getContractFactory('Lotty');
		const lottyStakingFactory = await ethers.getContractFactory('LottyStaking');

		const lotty = lottyFactory.attach('0xB459F7204A8Ac84F9e7758d6d839eBD01670E35C'); // Attach to existing lotty contract

		const lottyOwner = await ethers.getImpersonatedSigner('0xC2bD3dE84972e5c9A86fAd6Ff62Cc32D1200586f') // Get lotty owner address
		await setBalance(lottyOwner.address, '0xffffffffffffffffff');

		const lottyStaking = await lottyStakingFactory.deploy(); // Deploy staking contract

		const uniswapV2Pair = new ethers.Contract('0x1840c51B131a51bb66F3019CC7B2d54e6d686E10', uniswapV2PairABI, ethers.provider);

		await lotty.connect(lottyOwner).setFeeExempt(lottyStaking.address, true); // Set staking contract as fee exempt
		return { lotty, lottyStaking, uniswapV2Pair }
	}

	const getAccount = async () => {
		const account = await ethers.getImpersonatedSigner('0x834aB56aAdD9708AEBf5074ed71821BA5670d8CA');
		await setBalance(account.address, '0xfffffffffffffffff');
		return account;
	}

	describe('Deployment Setup', () => {
		it('Should have zero totalLiquidity', async () => {
			const { lottyStaking: LottyStaking } = await loadFixture(setupContracts);
			expect(await LottyStaking.totalLiquidity()).to.equal(0);
			expect(await LottyStaking.stakeNonce()).to.equal(0);
		})

		it('Should have zero stakeNonce', async () => {
			const { lottyStaking: LottyStaking } = await loadFixture(setupContracts);
			expect(await LottyStaking.totalLiquidity()).to.equal(0);
			expect(await LottyStaking.stakeNonce()).to.equal(0);
		})

		it('Should check that test account has initial lotty balance', async () => {
			const { lotty: Lotty } = await loadFixture(setupContracts);
			const account = await loadFixture(getAccount);
			expect(await Lotty.balanceOf(account.address)).to.equal('52680158893850415736569183');
		})
	})

	describe('Staking', () => {
		describe('User stakes Lotty and ETH', () => {
			const stake = async () => {
				const { lotty: Lotty, lottyStaking: LottyStaking, uniswapV2Pair: UniswapV2Pair } = await loadFixture(setupContracts);
				const account = await loadFixture(getAccount);
				const LottyBalance = await Lotty.balanceOf(account.address);
				const currentBlockTimestamp = (await ethers.provider.getBlock()).timestamp;
				const approveTx = await Lotty.connect(account).approve(LottyStaking.address, ethers.constants.MaxUint256);

				const stakeTx = await LottyStaking.connect(account).stake(
					LottyBalance,
					1,
					1,
					currentBlockTimestamp + 60 * 30,
					24 * 60 * 60,
					{ value: ethers.utils.parseEther('0.1').toHexString(), gasLimit: ethers.BigNumber.from(400_000) }
				);
				const stakeReceipt = await stakeTx.wait();
				const approveReceipt = await approveTx.wait();
				return { Lotty, LottyStaking, UniswapV2Pair, account, stakeReceipt, approveReceipt }
			}

			it('Should have more than 0 liquidity tokens in the contract', async () => {
				const { LottyStaking, UniswapV2Pair } = await loadFixture(stake);

				expect(await UniswapV2Pair.balanceOf(LottyStaking.address)).to.equal(await LottyStaking.totalLiquidity());
			})

			it('Should increase stakeNonce by 1', async () => {
				const { LottyStaking } = await loadFixture(stake);

				expect(await LottyStaking.stakeNonce()).to.be.equal(1);
			})

			it('Should not have any Lotty left in the contract', async () => {
				const { Lotty, LottyStaking } = await loadFixture(stake);

				expect(await Lotty.balanceOf(LottyStaking.address)).to.equal(0);
			})

			it('Should not have any ETH left in the contract', async () => {
				const { LottyStaking } = await loadFixture(stake);

				expect(await ethers.provider.getBalance(LottyStaking.address)).to.equal(0);
			})

			it('Should refund leftover Lotty back to the user', async () => {
				const { lotty: LottyBeforeStake } = await loadFixture(setupContracts);
				const accountBeforeStake = await loadFixture(getAccount);
				const uniswapV2PairAddress = '0x1840c51B131a51bb66F3019CC7B2d54e6d686E10';
				const initialPoolBalance = await LottyBeforeStake.balanceOf(uniswapV2PairAddress);
				const initialAccountBalance = await LottyBeforeStake.balanceOf(accountBeforeStake.address);

				const { Lotty: LottyAfterStake, account: accountAfterStake } = await loadFixture(stake);
				const finalPoolBalance = await LottyAfterStake.balanceOf(uniswapV2PairAddress);
				const finalAccountBalance = await LottyAfterStake.balanceOf(accountAfterStake.address);
				const stakedAmount = finalPoolBalance.sub(initialPoolBalance);

				expect(initialAccountBalance.sub(finalAccountBalance)).to.equal(stakedAmount)
			})

			it('Should refund leftover ETH back to the user', async () => {
				const accountBeforeStake = await loadFixture(getAccount);
				const uniswapV2PairAddress = '0x1840c51B131a51bb66F3019CC7B2d54e6d686E10';
				const weth = (await ethers.getContractFactory('Lotty')).attach('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
				const initialPoolBalance = await weth.balanceOf(uniswapV2PairAddress);
				const initialAccountBalance = await ethers.provider.getBalance(accountBeforeStake.address);

				const { stakeReceipt, approveReceipt, account: accountAfterStake } = await loadFixture(stake);
				const finalPoolBalance = await weth.balanceOf(uniswapV2PairAddress);
				const finalAccountBalance = await ethers.provider.getBalance(accountAfterStake.address);
				const stakedAmount = finalPoolBalance.sub(initialPoolBalance);
				const gasFee = stakeReceipt.effectiveGasPrice.mul(stakeReceipt.gasUsed).add(approveReceipt.effectiveGasPrice.mul(approveReceipt.gasUsed));
				const accountBalanceDecrease = initialAccountBalance.sub(finalAccountBalance);

				expect(accountBalanceDecrease).to.equal(stakedAmount.add(gasFee));
			})

			it('Should not let another user unstake the position', async () => {
				const { LottyStaking } = await loadFixture(stake);
				const otherAccount = await ethers.getSigner();
				const currentBlockTimestamp = (await ethers.provider.getBlock()).timestamp;
				await expect(LottyStaking.connect(otherAccount).unstake(
					1,
					1,
					1,
					currentBlockTimestamp + 60 * 30
				)).to.be.revertedWithCustomError(LottyStaking, 'CallerDoesNotOwnPosition');
			})
		})

		describe('User unstakes Lotty and ETH', () => {
			const stake = async () => {
				const { lotty: Lotty, lottyStaking: LottyStaking, uniswapV2Pair: UniswapV2Pair } = await loadFixture(setupContracts);
				const account = await loadFixture(getAccount);
				const LottyBalance = await Lotty.balanceOf(account.address);
				const currentBlockTimestamp = (await ethers.provider.getBlock()).timestamp;
				await Lotty.connect(account).approve(LottyStaking.address, ethers.constants.MaxUint256);
				const tx = await LottyStaking.connect(account).stake(
					LottyBalance,
					1,
					1,
					currentBlockTimestamp + 60 * 30,
					24 * 60 * 60,
					{ value: ethers.utils.parseEther('0.1').toHexString(), gasLimit: ethers.BigNumber.from(400_000) }
				)
				const stakeReceipt = await tx.wait();
				return { Lotty, LottyStaking, UniswapV2Pair, account, stakeReceipt }
			}

			const stakeAndUnstake = async () => {
				const { Lotty, LottyStaking, UniswapV2Pair, account, stakeReceipt, approveReceipt } = await loadFixture(stake);
				const position = await LottyStaking.checkPosition(1);
				const unlockTime = position.timestamp.add(position.timeLocked);
				await time.increaseTo(unlockTime);
				const currentBlockTimestamp = (await ethers.provider.getBlock()).timestamp;
				const accountEtherBalanceBeforeUnstake = await ethers.provider.getBalance(account.address);
				const accountLottyBalanceBeforeUnstake = await Lotty.balanceOf(account.address);
				const tx = await LottyStaking.connect(account).unstake(
					1,
					0,
					0,
					currentBlockTimestamp + 60 * 30,
				);
				const unstakeReceipt = await tx.wait();
				return { accountEtherBalanceBeforeUnstake, accountLottyBalanceBeforeUnstake, Lotty, LottyStaking, UniswapV2Pair, account, stakeReceipt, approveReceipt, unstakeReceipt };
			}

			it('Should not let user unstake before the lock time has passed', async () => {
				const { LottyStaking, account } = await loadFixture(stake);
				const currentBlockTimestamp = (await ethers.provider.getBlock()).timestamp;
				await expect(LottyStaking.connect(account).unstake(
					1,
					1,
					1,
					currentBlockTimestamp + 60 * 30
				)).to.be.revertedWithCustomError(LottyStaking, 'PositionLocked');
			})

			it('Should let user unstake after lock time has passed', async () => {
				const { LottyStaking, account } = await loadFixture(stake);
				const position = await LottyStaking.checkPosition(1);
				const unlockTime = position.timestamp.add(position.timeLocked);
				await time.increaseTo(unlockTime);
				const currentBlockTimestamp = (await ethers.provider.getBlock()).timestamp;
				await expect(LottyStaking.connect(account).unstake(
					1,
					0,
					0,
					currentBlockTimestamp + 60 * 30,
				)).to.emit(LottyStaking, 'Unstake');
			})

			it('Should have 0 liquidity tokens in the contract', async () => {
				const { LottyStaking, UniswapV2Pair } = await loadFixture(stakeAndUnstake);

				expect(await UniswapV2Pair.balanceOf(LottyStaking.address)).to.equal(0);
			})

			it('Should set position owner to zero address', async () => {
				const { LottyStaking } = await loadFixture(stakeAndUnstake);
				expect((await LottyStaking.checkPosition(1))['owner']).to.equal(ethers.constants.AddressZero);
			})

			it('Should return the staked Lotty back to the user', async () => {
				const { accountLottyBalanceBeforeUnstake, Lotty, account } = await loadFixture(stakeAndUnstake);
				expect(accountLottyBalanceBeforeUnstake).to.be.lessThan(await Lotty.balanceOf(account.address));
			})

			it('Should return the staked Ether back to the user', async () => {
				const { accountEtherBalanceBeforeUnstake, account, unstakeReceipt } = await loadFixture(stakeAndUnstake);
				expect(accountEtherBalanceBeforeUnstake.sub(unstakeReceipt.effectiveGasPrice.mul(unstakeReceipt.gasUsed))).to.be.lessThan(await ethers.provider.getBalance(account.address));
			})

			it('Should not let user unstake twice', async () => {
				const { LottyStaking, account } = await loadFixture(stakeAndUnstake);
				const currentBlockTimestamp = (await ethers.provider.getBlock()).timestamp;
				await expect(LottyStaking.connect(account).unstake(
					1,
					0,
					0,
					currentBlockTimestamp + 60 * 30,
				)).to.be.revertedWithCustomError(LottyStaking, 'CallerDoesNotOwnPosition')
			})
		})
	})
})