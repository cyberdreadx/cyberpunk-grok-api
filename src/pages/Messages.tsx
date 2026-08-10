import React from "react";
import DirectMessages from "@/components/DirectMessages";
import MobileBottomNav from "@/components/MobileBottomNav";
import { useAuth } from "@/hooks/useAuth";

const MessagesPage: React.FC = () => {
  const { isAuthenticated } = useAuth();
  return (
    <>
      <DirectMessages />
      <MobileBottomNav isAuthenticated={isAuthenticated} />
    </>
  );
};
export default MessagesPage;
