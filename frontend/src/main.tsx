import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./store/AuthContext";
import { SavedListingsProvider } from "./store/SavedListingsContext";
import { SavedSearchesProvider } from "./store/SavedSearchesContext";
import { RecentSearchesProvider } from "./store/RecentSearchesContext";
import { ConfirmProvider } from "./store/ConfirmContext";
import "./index.css";

/**
 * Entry point.
 *
 * BrowserRouter is outermost so every provider below it can navigate, and the
 * auth provider wraps the rest because whether someone is signed in decides what
 * the navbar and the seller pages show.
 *
 * ConfirmProvider sits above the saved-data providers on purpose: those two ask
 * it to show the "log in to save" prompt when a logged-out visitor tries to save,
 * so it has to be an ancestor of them. Its dialog is `fixed` and high z-index, so
 * being higher in the tree does not stop it rendering above everything.
 */
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ConfirmProvider>
          <SavedListingsProvider>
            <SavedSearchesProvider>
              <RecentSearchesProvider>
                <App />
              </RecentSearchesProvider>
            </SavedSearchesProvider>
          </SavedListingsProvider>
        </ConfirmProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
