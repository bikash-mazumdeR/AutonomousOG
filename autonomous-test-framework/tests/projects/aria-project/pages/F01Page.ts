// @aria-generated project=aria-project feature=F-01 source=page-map
// Rendered from the verified page map by ARIA Agent 05. Do not edit by hand; regenerate instead.
import { Page, Locator } from '@playwright/test';
import { BasePage } from '../../../pages/BasePage';

/**
 * Page object for feature F-01. Every locator resolved to exactly one element during discovery.
 */
export class F01Page extends BasePage {
  constructor(page: Page) {
    super(page, 'F01Page');
  }

  /** Navigate to the "start" state. */
  async openStart(): Promise<void> {
    await this.navigate("/");
  }

  /**
   * Verified action sequence in state "start": fill usernameInput, fill passwordInput, click loginButton. Performs actions only and asserts nothing (verified by TC-015, TC-016, TC-038, TC-040).
   * @param {{ usernameInput: string, passwordInput: string }} values
   */
  async startClickLoginButtonFlow(values: { usernameInput: string; passwordInput: string }): Promise<void> {
    await this.usernameInput.fill(values.usernameInput);
    await this.passwordInput.fill(values.passwordInput);
    await this.loginButton.click();
  }

  /** main (state: start) */
  get loginContainerElement(): Locator {
    return this.page.getByTestId("login-container");
  }

  /** textbox "Username" (state: start) */
  get usernameInput(): Locator {
    return this.page.getByTestId("username");
  }

  /** password input "Password" (state: start) */
  get passwordInput(): Locator {
    return this.page.getByTestId("password");
  }

  /** button "Login" (state: start) */
  get loginButton(): Locator {
    return this.page.getByTestId("login-button");
  }

  /** div (state: start) */
  get loginCredentialsContainerElement(): Locator {
    return this.page.getByTestId("login-credentials-container");
  }

  /** div (state: start) */
  get loginCredentialsElement(): Locator {
    return this.page.getByTestId("login-credentials");
  }

  /** heading "Accepted usernames are:" (state: start) */
  get acceptedUsernamesAreHeading(): Locator {
    return this.page.getByRole("heading", { name: "Accepted usernames are:", exact: true });
  }

  /** div (state: start) */
  get loginPasswordElement(): Locator {
    return this.page.getByTestId("login-password");
  }

  /** heading "Password for all users:" (state: start) */
  get passwordForAllUsersHeading(): Locator {
    return this.page.getByRole("heading", { name: "Password for all users:", exact: true });
  }

  /** alert (state: start) */
  get errorElement(): Locator {
    return this.page.getByTestId("error");
  }

  /** button "Dismiss error" (state: start) */
  get errorButton(): Locator {
    return this.page.getByTestId("error-button");
  }

  /** header (state: inventory) */
  get headerContainerElement(): Locator {
    return this.page.getByTestId("header-container");
  }

  /** div (state: inventory) */
  get primaryHeaderElement(): Locator {
    return this.page.getByTestId("primary-header");
  }

  /** button "Open Menu" (state: inventory) */
  get openMenuButton(): Locator {
    return this.page.getByRole("button", { name: "Open Menu", exact: true });
  }

  /** img "Open Menu" (state: inventory) */
  get openMenuImage(): Locator {
    return this.page.getByTestId("open-menu");
  }

  /** button "All Items" (state: inventory) */
  get inventorySidebarLinkButton(): Locator {
    return this.page.getByTestId("inventory-sidebar-link");
  }

  /** button "Dynamic Catalog" (state: inventory) */
  get dynamicCatalogSidebarLinkButton(): Locator {
    return this.page.getByTestId("dynamic-catalog-sidebar-link");
  }

  /** link "About" (state: inventory) */
  get aboutSidebarLink(): Locator {
    return this.page.getByTestId("about-sidebar-link");
  }

  /** button "Logout" (state: inventory) */
  get logoutSidebarLinkButton(): Locator {
    return this.page.getByTestId("logout-sidebar-link");
  }

  /** button "Reset App State" (state: inventory) */
  get resetSidebarLinkButton(): Locator {
    return this.page.getByTestId("reset-sidebar-link");
  }

  /** button "Close Menu" (state: inventory) */
  get closeMenuButton(): Locator {
    return this.page.getByText("Close Menu", { exact: true });
  }

  /** img "Close Menu" (state: inventory) */
  get closeMenuImage(): Locator {
    return this.page.getByTestId("close-menu");
  }

  /** button "Cart, empty" (state: inventory) */
  get shoppingCartLinkButton(): Locator {
    return this.page.getByTestId("shopping-cart-link");
  }

  /** div (state: inventory) */
  get secondaryHeaderElement(): Locator {
    return this.page.getByTestId("secondary-header");
  }

  /** span (state: inventory) */
  get titleElement(): Locator {
    return this.page.getByTestId("title");
  }

  /** span (state: inventory) */
  get activeOptionElement(): Locator {
    return this.page.getByTestId("active-option");
  }

  /** combobox "Sort products" (state: inventory) */
  get productSortContainerSelect(): Locator {
    return this.page.getByTestId("product-sort-container");
  }

  /** div (state: inventory) */
  get inventoryContainerElement(): Locator {
    return this.page.getByTestId("inventory-container");
  }

  /** div (state: inventory) */
  get inventoryListElement(): Locator {
    return this.page.getByTestId("inventory-list");
  }

  /** button "View details for Sauce Labs Backpack" (state: inventory) */
  get item4ImgLinkButton(): Locator {
    return this.page.getByTestId("item-4-img-link");
  }

  /** img "Sauce Labs Backpack" (state: inventory) */
  get inventoryItemSauceLabsBackpackImage(): Locator {
    return this.page.getByTestId("inventory-item-sauce-labs-backpack-img");
  }

  /** button "View details for Sauce Labs Backpack" (state: inventory) */
  get item4TitleLinkButton(): Locator {
    return this.page.getByTestId("item-4-title-link");
  }

  /** button "Add to cart" (state: inventory) */
  get addToCartSauceLabsButton(): Locator {
    return this.page.getByTestId("add-to-cart-sauce-labs-backpack");
  }

  /** button "View details for Sauce Labs Bike Light" (state: inventory) */
  get item0ImgLinkButton(): Locator {
    return this.page.getByTestId("item-0-img-link");
  }

  /** img "Sauce Labs Bike Light" (state: inventory) */
  get inventoryItemSauceLabsBikeImage(): Locator {
    return this.page.getByTestId("inventory-item-sauce-labs-bike-light-img");
  }

  /** button "View details for Sauce Labs Bike Light" (state: inventory) */
  get item0TitleLinkButton(): Locator {
    return this.page.getByTestId("item-0-title-link");
  }

  /** button "Add to cart" (state: inventory) */
  get addToCartSauceLabsButton2(): Locator {
    return this.page.getByTestId("add-to-cart-sauce-labs-bike-light");
  }

  /** button "View details for Sauce Labs Bolt T-Shirt" (state: inventory) */
  get item1ImgLinkButton(): Locator {
    return this.page.getByTestId("item-1-img-link");
  }

  /** img "Sauce Labs Bolt T-Shirt" (state: inventory) */
  get inventoryItemSauceLabsBoltImage(): Locator {
    return this.page.getByTestId("inventory-item-sauce-labs-bolt-t-shirt-img");
  }

  /** button "View details for Sauce Labs Bolt T-Shirt" (state: inventory) */
  get item1TitleLinkButton(): Locator {
    return this.page.getByTestId("item-1-title-link");
  }

  /** button "Add to cart" (state: inventory) */
  get addToCartSauceLabsButton3(): Locator {
    return this.page.getByTestId("add-to-cart-sauce-labs-bolt-t-shirt");
  }

  /** button "View details for Sauce Labs Fleece Jacket" (state: inventory) */
  get item5ImgLinkButton(): Locator {
    return this.page.getByTestId("item-5-img-link");
  }

  /** img "Sauce Labs Fleece Jacket" (state: inventory) */
  get inventoryItemSauceLabsFleeceImage(): Locator {
    return this.page.getByTestId("inventory-item-sauce-labs-fleece-jacket-img");
  }

  /** button "View details for Sauce Labs Fleece Jacket" (state: inventory) */
  get item5TitleLinkButton(): Locator {
    return this.page.getByTestId("item-5-title-link");
  }

  /** button "Add to cart" (state: inventory) */
  get addToCartSauceLabsButton4(): Locator {
    return this.page.getByTestId("add-to-cart-sauce-labs-fleece-jacket");
  }

  /** button "View details for Sauce Labs Onesie" (state: inventory) */
  get item2ImgLinkButton(): Locator {
    return this.page.getByTestId("item-2-img-link");
  }

  /** img "Sauce Labs Onesie" (state: inventory) */
  get inventoryItemSauceLabsOnesieImage(): Locator {
    return this.page.getByTestId("inventory-item-sauce-labs-onesie-img");
  }

  /** button "View details for Sauce Labs Onesie" (state: inventory) */
  get item2TitleLinkButton(): Locator {
    return this.page.getByTestId("item-2-title-link");
  }

  /** button "Add to cart" (state: inventory) */
  get addToCartSauceLabsButton5(): Locator {
    return this.page.getByTestId("add-to-cart-sauce-labs-onesie");
  }

  /** button "View details for Test.allTheThings() T-Shirt (Red)" (state: inventory) */
  get item3ImgLinkButton(): Locator {
    return this.page.getByTestId("item-3-img-link");
  }

  /** img "Test.allTheThings() T-Shirt (Red)" (state: inventory) */
  get inventoryItemTestAllthethingsTImage(): Locator {
    return this.page.getByTestId("inventory-item-test.allthethings()-t-shirt-(red)-img");
  }

  /** button "View details for Test.allTheThings() T-Shirt (Red)" (state: inventory) */
  get item3TitleLinkButton(): Locator {
    return this.page.getByTestId("item-3-title-link");
  }

  /** button "Add to cart" (state: inventory) */
  get addToCartTestAllthethingsButton(): Locator {
    return this.page.getByTestId("add-to-cart-test.allthethings()-t-shirt-(red)");
  }

  /** footer (state: inventory) */
  get footerElement(): Locator {
    return this.page.getByTestId("footer");
  }

  /** link "X" (state: inventory) */
  get socialXLink(): Locator {
    return this.page.getByTestId("social-x");
  }

  /** link "Facebook" (state: inventory) */
  get socialFacebookLink(): Locator {
    return this.page.getByTestId("social-facebook");
  }

  /** link "LinkedIn" (state: inventory) */
  get socialLinkedinLink(): Locator {
    return this.page.getByTestId("social-linkedin");
  }

  /** div (state: inventory) */
  get footerCopyElement(): Locator {
    return this.page.getByTestId("footer-copy");
  }
}
