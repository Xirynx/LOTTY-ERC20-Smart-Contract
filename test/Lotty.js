const { expect } = require('chai');
const { ethers } = require('hardhat');
const { loadFixture } = require('@nomicfoundation/hardhat-network-helpers');

describe('Lotty', () => {
	const TOTAL_SUPPLY = 1_000_000_000_000n * 10n ** 18n;

	const deployLotty = async () => {
		const contractFactory = await ethers.getContractFactory('Lotty');
		return await contractFactory.deploy();
	}

	describe('Deployment', () => {
		it('Should mint 1 trillion tokens to the deployer address', async () => {
			const Lotty = await loadFixture(deployLotty);
			const owner = await ethers.getSigner();

			expect(await Lotty.balanceOf(owner.address)).to.equal(TOTAL_SUPPLY);
		})

		it('Should exempt deployer from taxes', async () => {
			const Lotty = await loadFixture(deployLotty);
			const owner = await ethers.getSigner();

			expect(await Lotty.isFeeExempt(owner.address)).to.equal(true);
		})

		it('Should set deployer as the fee accumulator', async () => {
			const Lotty = await loadFixture(deployLotty);
			const owner = await ethers.getSigner();

			expect(await Lotty.feeAccumulator()).to.equal(owner.address);
		})

		it('Should set the total supply to 1 trillion', async () => {
			const Lotty = await loadFixture(deployLotty);

			expect(await Lotty.totalSupply()).to.equal(TOTAL_SUPPLY);
		})
	})

	describe('Admin Modifications', () => {
		describe('Setting a fee accumulator', () => {
			it('Should set the fee accumulator to the given address', async () => {
				const Lotty = await loadFixture(deployLotty);
				const [, otherAccount] = await ethers.getSigners();

				await Lotty.setFeeAccumulator(otherAccount.address);
				expect(await Lotty.feeAccumulator()).to.equal(otherAccount.address);
			})

			it('Should fail when modified by account that isnt owner', async () => {
				const Lotty = await loadFixture(deployLotty);
				const [, otherAccount] = await ethers.getSigners();

				await expect(Lotty.connect(otherAccount).setFeeAccumulator(otherAccount.address)).to.be.revertedWith('Ownable: caller is not the owner');
			})

			it('Should fail when set to zero address', async () => {
				const Lotty = await loadFixture(deployLotty);

				await expect(Lotty.setFeeAccumulator(ethers.constants.AddressZero)).to.be.revertedWithCustomError(Lotty, 'InvalidAddress');
			})
		})

		describe('Exempting address from fees', () => {
			it('Should exempt address from fees', async () => {
				const Lotty = await loadFixture(deployLotty);
				const [, otherAccount] = await ethers.getSigners();

				await Lotty.setFeeExempt(otherAccount.address, true);
				expect(await Lotty.isFeeExempt(otherAccount.address)).to.equal(true);
			})

			it('Should un-exempt address from fees', async () => {
				const Lotty = await loadFixture(deployLotty);
				const owner = await ethers.getSigner();

				await Lotty.setFeeExempt(owner.address, false);
				expect(await Lotty.isFeeExempt(owner.address)).to.equal(false);
			})

			it('Should fail when modified by account that isnt owner', async () => {
				const Lotty = await loadFixture(deployLotty);
				const [, otherAccount] = await ethers.getSigners();

				await expect(Lotty.connect(otherAccount).setFeeExempt(otherAccount.address, true)).to.be.revertedWith('Ownable: caller is not the owner');
			})

			it('Should fail when set to zero address', async () => {
				const Lotty = await loadFixture(deployLotty);

				await expect(Lotty.setFeeExempt(ethers.constants.AddressZero, true)).to.be.revertedWithCustomError(Lotty, 'InvalidAddress');
			})
		})

		describe('Setting a fee rate for an address', () => {
			it('Should set the fee rate in basis points for the address', async () => {
				const Lotty = await loadFixture(deployLotty);
				const [, otherAccount] = await ethers.getSigners();

				await Lotty.setFeeRate(otherAccount.address, 100, 200);
				const [feeFrom, feeTo] = await Lotty.feeRate(otherAccount.address);
				expect(feeFrom).to.equal(100);
				expect(feeTo).to.equal(200);
			})

			it('Should fail when modified by account that isnt owner', async () => {
				const Lotty = await loadFixture(deployLotty);
				const [, otherAccount] = await ethers.getSigners();

				await Lotty.setFeeRate(otherAccount.address, 100, 200);
				await expect(Lotty.connect(otherAccount).setFeeRate(otherAccount.address, 100, 200)).to.be.revertedWith('Ownable: caller is not the owner');
			})

			it('Should fail when set to zero address', async () => {
				const Lotty = await loadFixture(deployLotty);

				await expect(Lotty.setFeeRate(ethers.constants.AddressZero, 100, 200)).to.be.revertedWithCustomError(Lotty, 'InvalidAddress');
			})

			it('Should fail when feeFrom is greater than 1000', async () => {
				const Lotty = await loadFixture(deployLotty);
				const [, otherAccount] = await ethers.getSigners();

				await expect(Lotty.setFeeRate(otherAccount.address, 1001, 200)).to.be.revertedWithCustomError(Lotty, 'InvalidFee');
			})

			it('Should fail when feeTo is greater than 1000', async () => {
				const Lotty = await loadFixture(deployLotty);
				const [, otherAccount] = await ethers.getSigners();

				await expect(Lotty.setFeeRate(otherAccount.address, 100, 1001)).to.be.revertedWithCustomError(Lotty, 'InvalidFee');
			})
		})
	})

	describe('Transfers', () => {
		const TRANSFER_AMOUNT = 1_000_000_000n;

		const deployAndSetupForTransfer = async () => {
			const contractFactory = await ethers.getContractFactory('Lotty');
			const Lotty = await contractFactory.deploy();

			// Wallet setup:
			// [0]owner: deployer wallet
			// [1]feeAccount: Fee accumulator
			// [2]account1: Starts with `TRANSFER_AMOUNT` tokens
			// [3]account2: No setup
			// [4]+: No setup
			const signers = await ethers.getSigners();

			await Lotty.setFeeAccumulator(signers[1].address);
			await Lotty.transfer(signers[2].address, TRANSFER_AMOUNT);

			return { Lotty, signers }
		}

		it('Should not tax transfers between accounts with no fee rates', async () => {
			const { Lotty, signers } = await loadFixture(deployAndSetupForTransfer);
			const [, feeAccount, account1, account2] = signers;

			await Lotty.connect(account1).transfer(account2.address, TRANSFER_AMOUNT);

			expect(await Lotty.balanceOf(account1.address)).to.equal(0);
			expect(await Lotty.balanceOf(account2.address)).to.equal(TRANSFER_AMOUNT); // account2 receives full amount
			expect(await Lotty.balanceOf(feeAccount.address)).to.equal(0); // No fees accumulated
		})

		it('Should tax transfers to account with "feeTo"', async () => {
			const { Lotty, signers } = await loadFixture(deployAndSetupForTransfer);
			const [, feeAccount, account1, account2] = signers;
			const FEE_AMOUNT = 1000n * TRANSFER_AMOUNT / 10_000n // 10% fee

			await Lotty.setFeeRate(account2.address, 0, 1000);
			await Lotty.connect(account1).transfer(account2.address, TRANSFER_AMOUNT);

			expect(await Lotty.balanceOf(account1.address)).to.equal(0);
			expect(await Lotty.balanceOf(account2.address)).to.equal(TRANSFER_AMOUNT - FEE_AMOUNT); // account2 receives amount after 10% tax
			expect(await Lotty.balanceOf(feeAccount.address)).to.equal(FEE_AMOUNT); // 10% fee is accumulated in this account
		})

		it('Should tax transfers from account with "feeFrom"', async () => {
			const { Lotty, signers } = await loadFixture(deployAndSetupForTransfer);
			const [, feeAccount, account1, account2] = signers;
			const FEE_AMOUNT = 1000n * TRANSFER_AMOUNT / 10_000n // 10% fee

			await Lotty.setFeeRate(account2.address, 0, 1000);
			await Lotty.connect(account1).transfer(account2.address, TRANSFER_AMOUNT);

			expect(await Lotty.balanceOf(account1.address)).to.equal(0);
			expect(await Lotty.balanceOf(account2.address)).to.equal(TRANSFER_AMOUNT - FEE_AMOUNT); // account2 receives amount after 10% tax
			expect(await Lotty.balanceOf(feeAccount.address)).to.equal(FEE_AMOUNT); // 10% fee is accumulated in this account
		})

		it('Should sum tax rates when transferring from account with "feeFrom" to account with "feeTo"', async () => {
			const { Lotty, signers } = await loadFixture(deployAndSetupForTransfer);
			const [, feeAccount, account1, account2] = signers;
			const FEE_AMOUNT = 2000n * TRANSFER_AMOUNT / 10_000n // 20% fee

			await Lotty.setFeeRate(account1.address, 1000, 0); // transferring from account1 = 10% tax
			await Lotty.setFeeRate(account2.address, 0, 1000); // transferring to account2 = 10% tax
			await Lotty.connect(account1).transfer(account2.address, TRANSFER_AMOUNT);

			expect(await Lotty.balanceOf(account1.address)).to.equal(0);
			expect(await Lotty.balanceOf(account2.address)).to.equal(TRANSFER_AMOUNT - FEE_AMOUNT); // account2 receives amount after 20% total tax
			expect(await Lotty.balanceOf(feeAccount.address)).to.equal(FEE_AMOUNT); // 20% total fee is accumulated in this account
		})

		it('Should not tax transfer from exempt account', async () => {
			const { Lotty, signers } = await loadFixture(deployAndSetupForTransfer);
			const [, feeAccount, account1, account2] = signers;

			await Lotty.setFeeExempt(account1.address, true);
			await Lotty.connect(account1).transfer(account2.address, TRANSFER_AMOUNT);

			expect(await Lotty.balanceOf(account1.address)).to.equal(0);
			expect(await Lotty.balanceOf(account2.address)).to.equal(TRANSFER_AMOUNT); // account2 receives full amount, due to account1 being tax exempt
			expect(await Lotty.balanceOf(feeAccount.address)).to.equal(0); // No fees accumulated
		})

		it('Should not tax transfer to exempt account', async () => {
			const { Lotty, signers } = await loadFixture(deployAndSetupForTransfer);
			const [, feeAccount, account1, account2] = signers;

			await Lotty.setFeeExempt(account2.address, true);
			await Lotty.connect(account1).transfer(account2.address, TRANSFER_AMOUNT);

			expect(await Lotty.balanceOf(account1.address)).to.equal(0);
			expect(await Lotty.balanceOf(account2.address)).to.equal(TRANSFER_AMOUNT); // account2 receives full amount, due to being tax exempt
			expect(await Lotty.balanceOf(feeAccount.address)).to.equal(0); // No fees accumulated
		})

		it('Should ignore fee rates when transferring from exempt account', async () => {
			const { Lotty, signers } = await loadFixture(deployAndSetupForTransfer);
			const [, feeAccount, account1, account2] = signers;

			// Set fee rates on both accounts (Expected to be ignored)
			await Lotty.setFeeRate(account1.address, 1000, 1000);
			await Lotty.setFeeRate(account2.address, 1000, 1000);
			await Lotty.setFeeExempt(account1.address, true);
			await Lotty.connect(account1).transfer(account2.address, TRANSFER_AMOUNT);

			expect(await Lotty.balanceOf(account1.address)).to.equal(0);
			expect(await Lotty.balanceOf(account2.address)).to.equal(TRANSFER_AMOUNT); // account2 receives full amount, due to owner being tax exempt
			expect(await Lotty.balanceOf(feeAccount.address)).to.equal(0); // No fees accumulated
		})

		it('Should ignore fee rates when transferring to exempt account', async () => {
			const { Lotty, signers } = await loadFixture(deployAndSetupForTransfer);
			const [, feeAccount, account1, account2] = signers;

			// Set fee rates on both accounts (Expected to be ignored)
			await Lotty.setFeeRate(account1.address, 1000, 1000);
			await Lotty.setFeeRate(account2.address, 1000, 1000);
			await Lotty.setFeeExempt(account2.address, true);
			await Lotty.connect(account1).transfer(account2.address, TRANSFER_AMOUNT);

			expect(await Lotty.balanceOf(account1.address)).to.equal(0);
			expect(await Lotty.balanceOf(account2.address)).to.equal(TRANSFER_AMOUNT); // account2 receives full amount, due to owner being tax exempt
			expect(await Lotty.balanceOf(feeAccount.address)).to.equal(0); // No fees accumulated
		})
	})

	describe('Approval Transfers', () => {
		const TRANSFER_AMOUNT = 1_000_000_000n;

		const deployAndSetupForTransferFrom = async () => {
			const contractFactory = await ethers.getContractFactory('Lotty');
			const Lotty = await contractFactory.deploy();

			// Wallet setup:
			// [0]owner: deployer wallet
			// [1]feeAccount: Fee accumulator
			// [2]account1: Starts with `TRANSFER_AMOUNT` tokens
			// [3]account2: Starts with no tokens
			// [4]account3: Approved to spend account1's balance
			// [5]+: No setup
			const signers = await ethers.getSigners();

			await Lotty.setFeeAccumulator(signers[1].address);
			await Lotty.transfer(signers[2].address, TRANSFER_AMOUNT);
			await Lotty.connect(signers[2]).approve(signers[4].address, TRANSFER_AMOUNT);
			Lotty.connect(signers[0]);

			return { Lotty, signers }
		}

		it('Should not tax transfers between accounts with no fee rates', async () => {
			const { Lotty, signers } = await loadFixture(deployAndSetupForTransferFrom);
			const [, feeAccount, account1, account2, account3] = signers;

			await Lotty.connect(account3).transferFrom(account1.address, account2.address, TRANSFER_AMOUNT);

			expect(await Lotty.balanceOf(account1.address)).to.equal(0);
			expect(await Lotty.balanceOf(account2.address)).to.equal(TRANSFER_AMOUNT); // account2 receives full amount
			expect(await Lotty.balanceOf(feeAccount.address)).to.equal(0); // No fees accumulated
		})

		it('Should tax transfers to account with "feeTo"', async () => {
			const { Lotty, signers } = await loadFixture(deployAndSetupForTransferFrom);
			const [, feeAccount, account1, account2, account3] = signers;
			const FEE_AMOUNT = 1000n * TRANSFER_AMOUNT / 10_000n // 10% fee

			await Lotty.setFeeRate(account2.address, 0, 1000);
			await Lotty.connect(account3).transferFrom(account1.address, account2.address, TRANSFER_AMOUNT);

			expect(await Lotty.balanceOf(account1.address)).to.equal(0);
			expect(await Lotty.balanceOf(account2.address)).to.equal(TRANSFER_AMOUNT - FEE_AMOUNT); // account2 receives amount after 10% tax
			expect(await Lotty.balanceOf(feeAccount.address)).to.equal(FEE_AMOUNT); // 10% fee is accumulated in this account
		})

		it('Should tax transfers from account with "feeFrom"', async () => {
			const { Lotty, signers } = await loadFixture(deployAndSetupForTransferFrom);
			const [, feeAccount, account1, account2, account3] = signers;
			const FEE_AMOUNT = 1000n * TRANSFER_AMOUNT / 10_000n // 10% fee

			await Lotty.setFeeRate(account2.address, 0, 1000);
			await Lotty.connect(account3).transferFrom(account1.address, account2.address, TRANSFER_AMOUNT);

			expect(await Lotty.balanceOf(account1.address)).to.equal(0);
			expect(await Lotty.balanceOf(account2.address)).to.equal(TRANSFER_AMOUNT - FEE_AMOUNT); // account2 receives amount after 10% tax
			expect(await Lotty.balanceOf(feeAccount.address)).to.equal(FEE_AMOUNT); // 10% fee is accumulated in this account
		})

		it('Should sum tax rates when transferring from account with "feeFrom" to account with "feeTo"', async () => {
			const { Lotty, signers } = await loadFixture(deployAndSetupForTransferFrom);
			const [, feeAccount, account1, account2, account3] = signers;
			const FEE_AMOUNT = 2000n * TRANSFER_AMOUNT / 10_000n // 20% fee

			await Lotty.setFeeRate(account1.address, 1000, 0); // transferring from account1 = 10% tax
			await Lotty.setFeeRate(account2.address, 0, 1000); // transferring to account2 = 10% tax
			await Lotty.connect(account3).transferFrom(account1.address, account2.address, TRANSFER_AMOUNT);

			expect(await Lotty.balanceOf(account1.address)).to.equal(0);
			expect(await Lotty.balanceOf(account2.address)).to.equal(TRANSFER_AMOUNT - FEE_AMOUNT); // account2 receives amount after 20% total tax
			expect(await Lotty.balanceOf(feeAccount.address)).to.equal(FEE_AMOUNT); // 20% total fee is accumulated in this account
		})

		it('Should not tax transfer from exempt account', async () => {
			const { Lotty, signers } = await loadFixture(deployAndSetupForTransferFrom);
			const [, feeAccount, account1, account2, account3] = signers;

			await Lotty.setFeeExempt(account1.address, true);
			await Lotty.connect(account3).transferFrom(account1.address, account2.address, TRANSFER_AMOUNT);

			expect(await Lotty.balanceOf(account1.address)).to.equal(0);
			expect(await Lotty.balanceOf(account2.address)).to.equal(TRANSFER_AMOUNT); // account2 receives full amount, due to account1 being tax exempt
			expect(await Lotty.balanceOf(feeAccount.address)).to.equal(0); // No fees accumulated
		})

		it('Should not tax transfer to exempt account', async () => {
			const { Lotty, signers } = await loadFixture(deployAndSetupForTransferFrom);
			const [, feeAccount, account1, account2, account3] = signers;

			await Lotty.setFeeExempt(account2.address, true);
			await Lotty.connect(account3).transferFrom(account1.address, account2.address, TRANSFER_AMOUNT);

			expect(await Lotty.balanceOf(account1.address)).to.equal(0);
			expect(await Lotty.balanceOf(account2.address)).to.equal(TRANSFER_AMOUNT); // account2 receives full amount, due to being tax exempt
			expect(await Lotty.balanceOf(feeAccount.address)).to.equal(0); // No fees accumulated
		})

		it('Should ignore fee rates when transferring from exempt account', async () => {
			const { Lotty, signers } = await loadFixture(deployAndSetupForTransferFrom);
			const [, feeAccount, account1, account2, account3] = signers;

			// Set fee rates on both accounts (Expected to be ignored)
			await Lotty.setFeeRate(account1.address, 1000, 1000);
			await Lotty.setFeeRate(account2.address, 1000, 1000);
			await Lotty.setFeeExempt(account1.address, true);
			await Lotty.connect(account3).transferFrom(account1.address, account2.address, TRANSFER_AMOUNT);

			expect(await Lotty.balanceOf(account1.address)).to.equal(0);
			expect(await Lotty.balanceOf(account2.address)).to.equal(TRANSFER_AMOUNT); // account2 receives full amount, due to owner being tax exempt
			expect(await Lotty.balanceOf(feeAccount.address)).to.equal(0); // No fees accumulated
		})

		it('Should ignore fee rates when transferring to exempt account', async () => {
			const { Lotty, signers } = await loadFixture(deployAndSetupForTransferFrom);
			const [, feeAccount, account1, account2, account3] = signers;

			// Set fee rates on both accounts (Expected to be ignored)
			await Lotty.setFeeRate(account1.address, 1000, 1000);
			await Lotty.setFeeRate(account2.address, 1000, 1000);
			await Lotty.setFeeExempt(account2.address, true);
			await Lotty.connect(account3).transferFrom(account1.address, account2.address, TRANSFER_AMOUNT);

			expect(await Lotty.balanceOf(account1.address)).to.equal(0);
			expect(await Lotty.balanceOf(account2.address)).to.equal(TRANSFER_AMOUNT); // account2 receives full amount, due to owner being tax exempt
			expect(await Lotty.balanceOf(feeAccount.address)).to.equal(0); // No fees accumulated
		})
	})
});