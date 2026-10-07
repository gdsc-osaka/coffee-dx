export type OrderCartLine = {
  /** 注文送信時には除外する、画面内だけの行識別子 */
  id: string;
  menuItemId: string;
  name: string;
  basePrice: number;
  unitPriceAtOrder: number;
  quantity: number;
};

export type MenuItem = {
  id: string;
  name: string;
  price: number;
};

function createCartLineId(): string {
  const randomUUID = globalThis.crypto?.randomUUID?.();
  return randomUUID
    ? `cart-line-${randomUUID}`
    : `cart-line-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getBasePriceQuantity(
  cart: OrderCartLine[],
  menuItemId: string,
  basePrice: number,
): number {
  return (
    cart.find((line) => line.menuItemId === menuItemId && line.unitPriceAtOrder === basePrice)
      ?.quantity ?? 0
  );
}

export function addBasePriceItem(cart: OrderCartLine[], item: MenuItem): OrderCartLine[] {
  const index = cart.findIndex(
    (line) => line.menuItemId === item.id && line.unitPriceAtOrder === item.price,
  );
  if (index === -1) {
    return [
      ...cart,
      {
        id: createCartLineId(),
        menuItemId: item.id,
        name: item.name,
        basePrice: item.price,
        unitPriceAtOrder: item.price,
        quantity: 1,
      },
    ];
  }

  return cart.map((line, lineIndex) =>
    lineIndex === index ? { ...line, quantity: line.quantity + 1 } : line,
  );
}

export function removeOneMenuItem(
  cart: OrderCartLine[],
  menuItemId: string,
  basePrice: number,
): OrderCartLine[] {
  const index = cart.findIndex(
    (line) => line.menuItemId === menuItemId && line.unitPriceAtOrder === basePrice,
  );
  if (index === -1) return cart;

  return cart.flatMap((line, lineIndex) => {
    if (lineIndex !== index) return [line];
    return line.quantity > 1 ? [{ ...line, quantity: line.quantity - 1 }] : [];
  });
}

export function addPriceLine(
  cart: OrderCartLine[],
  item: MenuItem,
  adjustedPrice: number,
  quantity: number,
): OrderCartLine[] {
  if (!Number.isSafeInteger(adjustedPrice) || adjustedPrice < 0) return cart;
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return cart;

  const adjustedIndex = cart.findIndex(
    (line) => line.menuItemId === item.id && line.unitPriceAtOrder === adjustedPrice,
  );
  if (adjustedIndex !== -1) {
    return cart.map((line, lineIndex) =>
      lineIndex === adjustedIndex ? { ...line, quantity: line.quantity + quantity } : line,
    );
  }

  return [
    ...cart,
    {
      id: createCartLineId(),
      menuItemId: item.id,
      name: item.name,
      basePrice: item.price,
      unitPriceAtOrder: adjustedPrice,
      quantity,
    },
  ];
}

export function updatePriceLineQuantity(
  cart: OrderCartLine[],
  lineId: string,
  quantity: number,
): OrderCartLine[] {
  const index = cart.findIndex((line) => line.id === lineId);
  if (index === -1 || !Number.isSafeInteger(quantity) || quantity < 0) return cart;
  return cart.flatMap((line, lineIndex) => {
    if (lineIndex !== index) return [line];
    return quantity === 0 ? [] : [{ ...line, quantity }];
  });
}

export function updatePriceLinePrice(
  cart: OrderCartLine[],
  lineId: string,
  nextPrice: number,
): OrderCartLine[] {
  if (!Number.isSafeInteger(nextPrice) || nextPrice < 0) return cart;
  const currentIndex = cart.findIndex((line) => line.id === lineId);
  if (currentIndex === -1 || cart[currentIndex].unitPriceAtOrder === nextPrice) return cart;

  const currentLine = cart[currentIndex];
  const nextIndex = cart.findIndex(
    (line) => line.menuItemId === currentLine.menuItemId && line.unitPriceAtOrder === nextPrice,
  );
  if (nextIndex !== -1) {
    return cart.flatMap((line, lineIndex) => {
      if (lineIndex === nextIndex) return [];
      if (lineIndex === currentIndex) {
        return [
          {
            ...line,
            unitPriceAtOrder: nextPrice,
            quantity: line.quantity + cart[nextIndex].quantity,
          },
        ];
      }
      return [line];
    });
  }

  return cart.map((line, lineIndex) =>
    lineIndex === currentIndex ? { ...line, unitPriceAtOrder: nextPrice } : line,
  );
}
