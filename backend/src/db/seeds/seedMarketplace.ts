/**
 * Seeds the classifieds marketplace: categories, subcategories and listings.
 *
 * Two rules govern this file.
 *
 * **The main category is the required one.** Subcategories are a browsing
 * convenience — `listings.subcategory_slug` is nullable and nothing depends on
 * a listing being filed that finely.
 *
 * **Photos are bound per listing, never per category.** An item either names
 * the exact product in the image manifest whose photographs it uses — taking
 * *all* its images from that one product, so cover and gallery show the same
 * object — or it gets a card generated for that specific item, labelled with
 * its own name. An earlier version matched on category and picked at random,
 * which put a bed on a sofa listing. Nothing here can produce that: an item
 * with no photograph of itself never borrows one from a neighbour.
 *
 * Run with:  npm run seed:marketplace
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { Client } from "pg";
import { config } from "../../config/env";
import type { ImageManifestEntry } from "../../scripts/fetchListingImages";

const MANIFEST = path.join(config.imagesDir, "api", "manifest.json");
const GENERATED_DIR = path.join(config.imagesDir, "generated");
const ITEMS_MANIFEST = path.join(config.imagesDir, "items", "items-manifest.json");

/** Main categories, and the subcategories browsing offers beneath each. */
const CATEGORIES: { slug: string; label: string; subs: [string, string][] }[] = [
  { slug: "mobiles", label: "Mobiles", subs: [
    ["smartphones", "Smartphones"], ["tablets", "Tablets"],
    ["feature-phones", "Feature Phones"], ["smart-watches", "Smart Watches"],
    ["mobile-accessories", "Mobile Accessories"]] },
  { slug: "electronics", label: "Electronics & Appliances", subs: [
    ["tvs", "TVs"], ["refrigerators", "Refrigerators"],
    ["washing-machines", "Washing Machines"], ["air-conditioners", "Air Conditioners"],
    ["speakers", "Speakers"], ["headphones", "Headphones"],
    ["kitchen-appliances", "Kitchen Appliances"]] },
  { slug: "computers", label: "Computers & Laptops", subs: [
    ["laptops", "Laptops"], ["desktops", "Desktop Computers"],
    ["monitors", "Monitors"], ["keyboards-mouse", "Keyboards & Mouse"],
    ["printers", "Printers"], ["computer-accessories", "Computer Accessories"]] },
  { slug: "cars", label: "Cars", subs: [
    ["hatchback", "Hatchback"], ["sedan", "Sedan"], ["suv", "SUV"],
    ["luxury-cars", "Luxury Cars"], ["other-cars", "Other Cars"]] },
  { slug: "bikes", label: "Bikes", subs: [
    ["motorcycles", "Motorcycles"], ["scooters", "Scooters"],
    ["electric-bikes", "Electric Bikes"], ["bicycles", "Bicycles"],
    ["bike-accessories", "Bike Accessories"]] },
  { slug: "furniture", label: "Furniture", subs: [
    ["sofa-sets", "Sofa Sets"], ["beds", "Beds"], ["wardrobes", "Wardrobes"],
    ["study-tables", "Study Tables"], ["dining-sets", "Dining Tables & Chairs"],
    ["office-furniture", "Office Furniture"], ["storage", "Cabinets & Storage"]] },
  { slug: "home-kitchen", label: "Home & Kitchen", subs: [
    ["kitchen-items", "Kitchen Items"], ["cookware", "Cookware"],
    ["home-decor", "Home Decor"], ["lighting", "Lighting"],
    ["curtains-rugs", "Curtains & Rugs"], ["organizers", "Storage & Organizers"]] },
  { slug: "mens-fashion", label: "Men's Fashion", subs: [
    ["mens-tshirts", "T-Shirts"], ["mens-shirts", "Shirts"],
    ["mens-jeans", "Jeans & Trousers"], ["mens-jackets", "Jackets"],
    ["mens-ethnic", "Ethnic Wear"], ["mens-footwear", "Footwear"],
    ["mens-watches", "Watches & Accessories"]] },
  { slug: "womens-fashion", label: "Women's Fashion", subs: [
    ["womens-dresses", "Dresses"], ["womens-tops", "Tops & Shirts"],
    ["womens-jeans", "Jeans & Trousers"], ["sarees", "Sarees"],
    ["kurtis", "Kurtis"], ["womens-ethnic", "Ethnic Wear"],
    ["womens-footwear", "Footwear"], ["womens-bags", "Bags & Accessories"]] },
  { slug: "books-stationery", label: "Books & Stationery", subs: [
    ["novels", "Novels"], ["school-books", "School Books"],
    ["college-textbooks", "College Textbooks"], ["exam-books", "Competitive Exam Books"],
    ["notebooks", "Notebooks"], ["art-supplies", "Art & Craft Supplies"],
    ["stationery", "Stationery"]] },
  { slug: "sports", label: "Sports & Fitness", subs: [
    ["cricket", "Cricket"], ["football", "Football"], ["badminton", "Badminton"],
    ["gym-equipment", "Gym Equipment"], ["cycling", "Cycling"],
    ["yoga-fitness", "Yoga & Fitness"], ["sports-accessories", "Sports Accessories"]] },
  { slug: "toys", label: "Toys & Games", subs: [
    ["kids-toys", "Kids Toys"], ["board-games", "Board Games"],
    ["puzzles", "Puzzles"], ["video-games", "Video Games"],
    ["gaming-accessories", "Gaming Accessories"], ["collectibles", "Collectibles"]] },
  { slug: "music", label: "Musical Instruments", subs: [
    ["guitars", "Guitars"], ["keyboards", "Keyboards"], ["drums", "Drums"],
    ["tabla", "Tabla"], ["microphones", "Microphones"],
    ["other-instruments", "Other Instruments"]] },
  { slug: "cameras", label: "Cameras & Photography", subs: [
    ["dslr", "DSLR Cameras"], ["mirrorless", "Mirrorless Cameras"],
    ["lenses", "Lenses"], ["tripods", "Tripods"],
    ["camera-accessories", "Camera Accessories"]] },
  { slug: "pets", label: "Pets & Pet Supplies", subs: [
    ["pet-accessories", "Pet Accessories"], ["pet-beds", "Pet Beds"],
    ["pet-toys", "Pet Toys"], ["aquariums", "Aquariums"],
    ["pet-supplies", "Pet Supplies"]] },
  { slug: "accessories", label: "Accessories", subs: [
    ["bags", "Bags"], ["watches", "Watches"], ["sunglasses", "Sunglasses"],
    ["wallets", "Wallets"], ["jewellery", "Jewellery"],
    ["other-accessories", "Other Accessories"]] },
];

const CITIES = [
  ["Mumbai", "Bandra"], ["Mumbai", "Andheri"], ["Delhi", "Saket"],
  ["Delhi", "Dwarka"], ["Bengaluru", "Koramangala"], ["Bengaluru", "Indiranagar"],
  ["Hyderabad", "Gachibowli"], ["Pune", "Kothrud"], ["Chennai", "Adyar"],
  ["Kolkata", "Salt Lake"], ["Ahmedabad", "Satellite"], ["Jaipur", "Vaishali Nagar"],
];

type Condition = "New with tags" | "Like new" | "Good" | "Fair";

/** [title, subcategory, manifest product or null, price, condition, description] */
export type Item = [string, string, string | null, number, Condition, string];

export const ITEMS: Record<string, Item[]> = {
  mobiles: [
    ["Used iPhone 13 Pro 128GB — Excellent Condition", "smartphones", "iPhone 13 Pro", 62000, "Like new", "Bought 2024, battery health 89%. Always in a case with a screen guard, so no scratches anywhere. Box, cable and bill included. Selling as I have switched to an Android."],
    ["iPhone X 64GB — Screen Replaced, Works Great", "smartphones", "iPhone X", 21000, "Good", "Face ID works perfectly. Screen was replaced last year with an original Apple panel at an authorised centre — bill available. Small dent on the bottom edge. Good reliable daily phone."],
    ["Samsung Galaxy S10 — Well Maintained", "smartphones", "Samsung Galaxy S10", 18000, "Good", "Prism blue, 128GB dual SIM. Three years old, used carefully. Minor scuff on the frame, display is flawless. Battery lasts a full day. Charger included."],
    ["Samsung Galaxy S8 — Spare Phone", "smartphones", "Samsung Galaxy S8", 9000, "Fair", "Older but completely functional. Curved display has no cracks. Battery needs a midday top-up now. Honest listing — good as a backup or a first phone for a student."],
    ["Oppo F19 Pro Plus 5G — 1 Year Old", "smartphones", "Oppo F19 Pro Plus", 14500, "Like new", "8/128GB with 50W fast charging. Bought a year ago, screen guard from day one. No repairs. Selling because I received a phone from work."],
    ["Realme XT — Good Camera, Good Condition", "smartphones", "Realme XT", 8500, "Good", "64MP camera, 128GB storage. Light scratches on the back that a cover hides. Everything works as it should. Box and charger available."],
    ["Vivo X21 — Working Well", "smartphones", "Vivo X21", 7500, "Fair", "Under-display fingerprint still responsive. Some wear around the edges from three years of use. Battery replaced last year. Priced to sell quickly."],
    ["Used iPhone 6 32GB — Collector or Spare", "feature-phones", "iPhone 6", 5500, "Fair", "Genuinely old now but fully functional. Battery replaced last year. Home button works. Good as a spare, a car phone, or for someone who wants something simple."],
    ["iPad Mini 2021 Starlight — Barely Used", "tablets", "iPad Mini 2021 Starlight", 34000, "Like new", "64GB WiFi, bought for reading and note-taking but I use my laptop instead. Perhaps twenty hours of use total. No marks at all. Apple Pencil 2 compatible."],
    ["Samsung Galaxy Tab S8 Plus — Excellent", "tablets", "Samsung Galaxy Tab S8 Plus Grey", 48000, "Like new", "12.4-inch AMOLED with the S-Pen included. Kept in a folio case since new, screen is pristine. Selling as I rarely use a tablet this size."],
    ["Apple Watch Series 4 Gold 40mm", "smart-watches", "Apple Watch Series 4 Gold", 14000, "Good", "GPS model. Battery health still good for a full day. Light scuffing on the case edge, screen clean. Two straps and the charger included."],
    ["Apple MagSafe Battery Pack — Gently Used", "mobile-accessories", "Apple MagSafe Battery Pack", 5500, "Good", "Snaps on and charges reliably. A few surface marks from being in a bag. Genuine Apple, no swelling or heat issues."],
    ["Apple 20W USB-C Charger — Genuine", "mobile-accessories", "Apple iPhone Charger", 1200, "Like new", "Original Apple adapter, fast charges an iPhone properly. Cable not included. Spare from a phone purchase, barely used."],
    ["iPhone 12 Silicone Case MagSafe — Plum", "mobile-accessories", "iPhone 12 Silicone Case with MagSafe Plum", 1400, "Good", "Genuine Apple case. Magnets still strong. Slight darkening on one corner from handling, no tears or stretching."],
  ],
  electronics: [
    ["Apple AirPods Max Silver — Excellent Condition", "headphones", "Apple AirPods Max Silver", 38000, "Like new", "Over-ear with active noise cancelling. Ear cushions still firm and clean. Smart case included. Selling because I mostly use in-ears now."],
    ["Used Apple AirPods 2nd Gen", "headphones", "Apple Airpods", 7500, "Good", "Both buds hold charge for around four hours. Case has light scuffing from pocket use. Cleaned thoroughly before listing. Charging cable included."],
    ["Beats Flex Wireless Earphones — Gently Used", "headphones", "Beats Flex Wireless Earphones", 2800, "Good", "Neckband style with magnetic buds. Battery still lasts a full working day. Cable and ear tips included, no damage."],
    ["Amazon Echo Plus Smart Speaker", "speakers", "Amazon Echo Plus", 5500, "Good", "Built-in smart home hub. Sound is full and clear. Fabric has a small mark on the back. Power adapter included, works perfectly."],
    ["Apple HomePod Mini — Cosmic Grey", "speakers", "Apple HomePod Mini Cosmic Grey", 6800, "Like new", "Compact but surprisingly loud. Used in a bedroom for about six months. Original box and cable. Selling as we moved to a larger speaker."],
    ["Used Microwave Oven 20L — Working Well", "kitchen-appliances", "Microwave Oven", 4200, "Good", "Four years old, used daily for reheating. Turntable and manual included. Interior cleaned, no rust. Door seal is intact."],
    ["Two-Burner Electric Stove — Backup Hob", "kitchen-appliances", "Electric Stove", 2400, "Good", "Both burners heat evenly. Glass top unscratched. Used as a backup during a kitchen renovation, so very little running time."],
    ["Countertop Blender — Lightly Used", "kitchen-appliances", "Boxed Blender", 2800, "Like new", "Powerful motor, glass jar with no chips. Used perhaps ten times. Still has the original box. Selling as we received a second one as a gift."],
    ["Hand Blender Stick Mixer", "kitchen-appliances", "Hand Blender", 1400, "Good", "Immersion blender with whisk attachment. Motor is strong, no burning smell. Great for soups and baby food."],
    ["Used LED TV 43-inch — Good Picture", "tvs", null, 14000, "Good", "Four years old, picture is still sharp with no dead pixels or backlight bleed. Remote and wall mount included. Selling because we upgraded to a larger screen."],
    ["Double Door Refrigerator 260L", "refrigerators", null, 16500, "Good", "Frost free, 3-star rating. Cooling is strong, no leaks or noise. Six years old and well looked after. Shelves and trays all present."],
    ["Front Load Washing Machine 6.5kg", "washing-machines", null, 14500, "Good", "Fully automatic, all programmes working. Recently serviced with a new inlet pipe. Drum is clean. Moving abroad, so selling."],
    ["Split AC 1.5 Ton — Serviced", "air-conditioners", null, 21000, "Good", "3-star inverter unit, four years old. Gas refilled last summer and cools a room quickly. Indoor and outdoor units both included."],
  ],
  computers: [
    ["Used MacBook Pro 14-inch M1 Pro", "laptops", "Apple MacBook Pro 14 Inch Space Grey", 145000, "Like new", "16GB/512GB space grey. Cycle count under 180, battery health excellent. No dents or keyboard shine. Original charger. Selling as work provided a machine."],
    ["Dell XPS 13 9300 — 2 Years Old", "laptops", "New DELL XPS 13 9300 Laptop", 68000, "Good", "i7, 16GB RAM, 512GB SSD. Two years of light office use. Battery holds around five hours. Tiny scuff on the lid corner, screen perfect."],
    ["Lenovo Yoga 920 2-in-1 — Good Condition", "laptops", "Lenovo Yoga 920", 46000, "Good", "Touchscreen convertible with stylus. Hinge is still tight with no wobble. Some key shine on the space bar. Great for notes and reading."],
    ["Asus Zenbook Pro Dual Screen", "laptops", "Asus Zenbook Pro Dual Screen Laptop", 118000, "Like new", "Second display above the keyboard, brilliant for video editing. Both screens flawless. Barely used — bought for a project that finished early."],
    ["Huawei MateBook X Pro — Light and Fast", "laptops", "Huawei Matebook X Pro", 52000, "Good", "3K touch display, very light to carry. Minor wear on one corner from a bag. Battery still good for four hours. Charger included."],
    ["Used 24-inch IPS Monitor", "monitors", null, 8500, "Good", "1080p, 75Hz, HDMI and DisplayPort. Used for work from home for two years. No dead pixels, stand included. Selling as I moved to an ultrawide."],
    ["Mechanical Keyboard and Mouse Set", "keyboards-mouse", null, 3200, "Good", "Blue switches, all keys responsive. Mouse has a little wear on the left button. Both wired, no software needed."],
    ["All-in-One Inkjet Printer", "printers", null, 3200, "Fair", "Print, scan and copy all working. Needs a new black cartridge — colour is half full. Occasional paper feed jam if you overfill the tray. Honest price for that."],
  ],
  cars: [
    ["Chrysler 300 Touring — Single Owner", "sedan", "300 Touring", 850000, "Good", "Full-size sedan, petrol automatic. 62,000 km with complete service history at the authorised centre. Insurance valid. Two small parking scuffs on the rear bumper."],
    ["Dodge Charger SXT RWD — Well Maintained", "sedan", "Charger SXT RWD", 1250000, "Good", "Rear-wheel drive, 48,000 km. New tyres fitted this year. Serviced every 10,000 km without fail. Papers clear, no accident history."],
    ["Dodge Hornet GT Plus — Under Warranty", "suv", "Dodge Hornet GT Plus", 1450000, "Like new", "Compact SUV with only 19,000 km. Still under manufacturer warranty, transferable. Showroom condition inside and out. Selling due to relocation."],
    ["Dodge Durango SXT RWD — 3-Row SUV", "suv", "Durango SXT RWD", 1650000, "Good", "Seven seats, ideal for a large family. 71,000 km. Papers clear, no accidents. Interior has normal wear on the driver's seat bolster."],
    ["Chrysler Pacifica Touring — Family MPV", "other-cars", "Pacifica Touring", 1150000, "Good", "Seven-seater with sliding doors, brilliant with children. 55,000 km, serviced on schedule. Third row folds flat. One owner from new."],
  ],
  bikes: [
    ["Kawasaki Z800 — Adult Owned, Never Raced", "motorcycles", "Kawasaki Z800", 385000, "Good", "24,000 km with all service records. Stock exhaust included along with the aftermarket one fitted. Chain and sprocket replaced 3,000 km ago."],
    ["Sportbike 600cc — Track Capable", "motorcycles", "Sportbike Motorcycle", 295000, "Good", "18,000 km, road legal. Recently serviced with a new chain kit. Fairing has a small crack on the left side, photographed honestly. Rides beautifully."],
    ["MotoGP Replica — Collector's Bike", "motorcycles", "MotoGP CI.H1", 450000, "Like new", "Display condition, rarely ridden and stored indoors under a cover. Every panel is unmarked. Selling because it deserves someone who will actually use it."],
    ["Automatic Scooter 125cc — City Runabout", "scooters", "Scooter Motorcycle", 52000, "Good", "14,000 km, excellent mileage. New battery three months ago. Front apron has a scratch from a parking knock. Perfect daily commuter."],
    ["Commuter Motorcycle 150cc — Single Owner", "motorcycles", "Generic Motorcycle", 68000, "Good", "21,000 km, single owner from new. All documents in order. Regular servicing, tyres at about 60%. Reliable and cheap to run."],
    ["Used Hybrid Bicycle — Serviced", "bicycles", null, 12000, "Good", "21-speed hybrid, great for commuting and weekend rides. Serviced last month with new brake pads. Small paint chip on the top tube."],
    ["Bike Helmet and Riding Gloves", "bike-accessories", null, 2200, "Good", "ISI-marked full-face helmet, size L, with matching gloves. Visor is clear and unscratched. No impacts. Selling as I bought a modular helmet."],
  ],
  furniture: [
    ["3-Seater Sofa — Good Condition", "sofa-sets", "Annibale Colombo Sofa", 42000, "Good", "Italian designer sofa in cream. Frame is solid, cushions recently re-filled. One arm has slight fading from sunlight, shown in the photos. Buyer to arrange pickup."],
    ["Designer Double Bed Frame — No Mattress", "beds", "Annibale Colombo Bed", 38000, "Good", "Solid frame that dismantles into four parts, all fittings included. Small dent on the footboard. Mattress not included. Moving house, must sell."],
    ["Bedside Table African Cherry", "storage", "Bedside Table African Cherry", 6500, "Good", "Solid cherry wood with one drawer that runs smoothly. Small scratch on the top which would polish out. Sturdy and heavy."],
    ["Knoll Saarinen Executive Chair", "office-furniture", "Knoll Saarinen Executive Conference Chair", 18000, "Good", "Genuine Knoll conference chair. Upholstery clean, swivel and tilt both work smoothly. Light wear on the armrests. Office closing down."],
    ["Wooden Bathroom Vanity with Mirror", "storage", "Wooden Bathroom Sink With Mirror", 14500, "Like new", "Complete vanity unit with basin and mirror. Removed during a renovation after eight months, undamaged. All plumbing fittings included."],
    ["Wooden Study Table — Minor Scratches", "study-tables", null, 3500, "Fair", "Sturdy table, perfect for a laptop and books. Two shelves and a drawer. Some scratches on the surface and a dent on one leg — priced accordingly."],
    ["3-Door Sliding Wardrobe", "wardrobes", null, 19000, "Good", "Mirror on the centre door, plenty of hanging space plus shelves. Dismantles easily. Runners are smooth. Slight veneer lift on one bottom corner."],
    ["6-Seater Dining Table with Chairs", "dining-sets", null, 22000, "Good", "Solid wood table with six cushioned chairs. Small scratch on the tabletop, easily polished out. Chair fabric is clean with no tears."],
  ],
  "home-kitchen": [
    ["Carbon Steel Wok 30cm — Well Seasoned", "cookware", "Carbon Steel Wok", 1200, "Good", "Naturally non-stick from proper seasoning. No warping, sits flat. Perfect for high-heat cooking. Selling as I switched to a bigger one."],
    ["Silver Pot with Glass Lid 5L", "cookware", "Silver Pot With Glass Cap", 900, "Good", "Stainless steel stockpot. No dents, base is flat and true. Lid glass has no chips. Handles are firm."],
    ["Chef's Kitchen Knife — Recently Sharpened", "kitchen-items", "Knife", 800, "Good", "Stainless steel, holds an edge well. Handle is solid with no play. Sharpened before listing."],
    ["Wooden Chopping Board", "kitchen-items", "Chopping Board", 600, "Good", "Thick hardwood, oiled regularly so no cracking. Light knife scoring on one face, none deep."],
    ["Stainless Steel Box Grater", "kitchen-items", "Grater Black", 450, "Good", "Four grating surfaces, all still sharp. Non-slip handle intact. Cleaned thoroughly."],
    ["Wooden Rolling Pin", "kitchen-items", "Wooden Rolling Pin", 350, "Like new", "Solid beech with a smooth finish. Used a handful of times. No warping or splits."],
    ["Rotating Spice Rack with 12 Jars", "organizers", "Spice Rack", 1100, "Good", "All twelve glass jars present with airtight lids. Turntable spins freely. Labels can be peeled off easily."],
    ["Insulated Lunch Box — 3 Compartments", "organizers", "Lunch Box", 700, "Good", "Leak-proof lid, keeps food warm for hours. Slight staining inside from turmeric, cleaned but visible."],
    ["Decorative Table Lamp", "lighting", "Table Lamp", 2200, "Good", "Warm bedside lamp with a working bulb included. Shade is clean and unmarked. Cable and switch both fine."],
    ["Ceramic Plant Pot with Saucer", "home-decor", "Plant Pot", 700, "Like new", "Glazed pot with a drainage hole and matching saucer. No chips or hairline cracks."],
    ["Artificial Showpiece Plant", "home-decor", "House Showpiece Plant", 1800, "Good", "Indoor plant in a ceramic pot, no maintenance needed. Leaves are dust-free and intact. Looks convincing from a distance."],
    ["Family Tree Photo Frame — 10 Photos", "home-decor", "Family Tree Photo Frame", 1400, "Good", "Multi-photo wall frame. All glass intact, hanging hooks on the back. Small mark on the frame edge."],
  ],
  "mens-fashion": [
    ["Men's Check Shirt — Gently Used", "mens-shirts", "Blue & Black Check Shirt", 700, "Good", "Cotton casual shirt, size L. Worn perhaps five times. No fading, all buttons present. Freshly laundered."],
    ["Men's Plaid Flannel Shirt", "mens-shirts", "Man Plaid Shirt", 650, "Good", "Soft and warm, size M. Some pilling under the arms from washing, otherwise good. Honest condition."],
    ["Men's Short Sleeve Summer Shirt", "mens-shirts", "Man Short Sleeve Shirt", 500, "Like new", "Lightweight, size M. Bought and worn once — wrong fit for me. Essentially new."],
    ["Nike Air Jordan 1 Red and Black — UK9", "mens-footwear", "Nike Air Jordan 1 Red And Black", 9500, "Good", "Genuine pair with the original box. Soles have plenty of life, no separation. Creasing on the toe box from normal wear."],
    ["Puma Future Rider Trainers — UK8", "mens-footwear", "Puma Future Rider Trainers", 3200, "Good", "Very comfortable everyday trainers. Cleaned before listing. Slight wear on the heel, plenty of use left."],
    ["Brown Leather Strap Watch", "mens-watches", "Brown Leather Belt Watch", 3200, "Good", "Classic dress watch, new battery fitted. Strap is supple with light creasing. Glass unscratched."],
    ["Longines Master Collection — Serviced", "mens-watches", "Longines Master Collection", 165000, "Like new", "Automatic dress watch with sapphire crystal. Serviced last year, keeping excellent time. Box and papers included."],
    ["Rolex Submariner — Box and Papers", "mens-watches", "Rolex Submariner Watch", 850000, "Like new", "Automatic dive watch, serviced and running within spec. Bracelet has minimal stretch. Full set including box and papers."],
    ["Men's Denim Jacket — Gently Used", "mens-jackets", null, 1800, "Good", "Classic blue denim, size L. Worn through one winter. No tears, all buttons intact. Slight fading at the cuffs which suits the style."],
    ["Men's Kurta Pyjama Set — Festive Wear", "mens-ethnic", null, 1400, "Like new", "Cream cotton kurta with matching pyjama, size L. Worn once for Diwali. Dry cleaned and stored in a garment bag."],
    ["Men's Cotton T-Shirts — Set of 3", "mens-tshirts", null, 900, "Good", "Three plain tees in navy, grey and white, size M. Washed regularly but no holes or stains. Necklines still firm."],
    ["Men's Slim Fit Jeans W32", "mens-jeans", null, 1100, "Good", "Dark indigo, W32 L32. Worn a dozen times. No fraying at the hems, zip and button both fine."],
  ],
  "womens-fashion": [
    ["Black Evening Gown — Worn Once", "womens-dresses", "Black Women's Gown", 4200, "Like new", "Floor length, size M. Worn once to a wedding and dry cleaned since. No marks or loose threads. Stored in a garment bag."],
    ["Marni Red & Black Suit — Designer", "womens-ethnic", "Marni Red & Black Suit", 6800, "Like new", "Designer two-piece, size S. Immaculate condition, kept in a garment bag. Selling as it no longer fits."],
    ["Calvin Klein Heel Shoes — UK6", "womens-footwear", "Calvin Klein Heel Shoes", 3800, "Good", "Genuine leather. Minor scuff on one heel tip which a cobbler could fix. Insoles clean, no odour."],
    ["Prada Women's Handbag — Like New", "womens-bags", "Prada Women Bag", 24000, "Like new", "Authentic with the dust bag. Leather is in lovely condition, all hardware works smoothly. Lining spotless. Receipt available."],
    ["Heshe Leather Shoulder Bag — Tan", "womens-bags", "Heshe Women's Leather Bag", 4500, "Good", "Full-grain leather that has aged nicely. Lining intact, zips run smoothly. Light darkening on the handles from use."],
    ["Green Crystal Drop Earrings", "womens-bags", "Green Crystal Earring", 1800, "Like new", "Sterling silver hooks, stones all secure. No discolouration. Worn twice."],
    ["Women's Saree — Silk, Worn Twice", "sarees", null, 3500, "Like new", "Kanjivaram-style silk saree in deep maroon with a gold border. Worn twice for family functions, dry cleaned. Blouse piece unstitched and included."],
    ["Cotton Kurti Set — Gently Used", "kurtis", null, 900, "Good", "Printed cotton kurti with palazzo, size M. Worn several times, colours still bright. No stains or loose stitching."],
    ["Women's Tops — Bundle of 4", "womens-tops", null, 1200, "Good", "Four casual tops, size S. Mixed colours. All washed and in good shape, minor pilling on one. Selling as a lot."],
    ["Women's High Waist Jeans — 28", "womens-jeans", null, 1300, "Good", "Dark wash, size 28. Stretchy and comfortable. Worn through one season, no fading or fraying."],
    ["Women's Ethnic Anarkali Suit", "womens-ethnic", null, 2800, "Like new", "Full-length anarkali with dupatta, size M. Worn once at a wedding. Dry cleaned, no damage to the embroidery."],
  ],
  "books-stationery": [
    ["Engineering Mathematics by B.S. Grewal", "college-textbooks", null, 450, "Good", "44th edition. No torn pages, binding intact. A few pencil marks in the margins that erase cleanly."],
    ["HC Verma Concepts of Physics — Both Volumes", "exam-books", null, 600, "Good", "Standard JEE reference. Covers slightly worn at the corners, all pages present and clean."],
    ["GATE Computer Science Study Package", "exam-books", null, 1800, "Like new", "Complete Made Easy set, ten books. Barely written in — I switched to online coaching. Excellent value."],
    ["UPSC General Studies Manual", "exam-books", null, 900, "Fair", "Latest edition. Spine is cracked from heavy use and a few pages have highlighter, but everything is readable."],
    ["NCERT Class 11 & 12 Science Set", "school-books", null, 1200, "Good", "Physics, Chemistry, Biology and Maths. All clean and complete. Light pencil underlining in the Chemistry books."],
    ["Cormen Introduction to Algorithms", "college-textbooks", null, 1400, "Good", "Third edition hardcover. Essential CS text. Dust jacket has a small tear, book itself is excellent."],
    ["Harry Potter Complete Box Set", "novels", null, 3200, "Good", "All seven paperbacks in the original slipcase. Read carefully once, spines barely creased. Slipcase has minor shelf wear."],
    ["Assorted Fiction Novels — Set of 8", "novels", null, 1100, "Good", "Mix of contemporary fiction, all paperback. Read once each, no markings. Selling to make shelf space."],
    ["Classmate Ruled Notebooks — Pack of 10", "notebooks", null, 400, "New with tags", "Ten notebooks, 200 pages each, still sealed. Bought in bulk for a course that was cancelled."],
    ["Faber-Castell Colour Pencils — 48 Shades", "art-supplies", null, 850, "Like new", "Full tin of 48, all pencils close to full length. Used for a few sketches only."],
    ["Camlin Drawing Instrument Box", "stationery", null, 550, "Good", "Compass, dividers, set squares and protractor. All pieces present and working. Box latch is a little loose."],
    ["Casio FX-991EX Scientific Calculator", "stationery", null, 1100, "Good", "Non-programmable, exam approved. Screen and keys perfect. Slide cover included. Used for two semesters."],
  ],
  sports: [
    ["Used Cricket Bat — English Willow", "cricket", "Cricket Bat", 4500, "Good", "Knocked in and match ready. One season of club cricket. Slight edge mark, no cracks. Grip recently replaced."],
    ["Cricket Helmet with Steel Grille", "cricket", "Cricket Helmet", 2200, "Good", "Senior size, adjustable. Never taken a serious blow. Padding is still firm, straps in good order."],
    ["Leather Cricket Ball", "cricket", "Cricket Ball", 700, "Good", "Four-piece leather, used for two matches. Seam still proud, shape held."],
    ["Metal Baseball Bat", "sports-accessories", "Metal Baseball Bat", 2400, "Good", "Aluminium alloy, no dents anywhere. Grip tape recently redone."],
    ["Baseball Glove — Broken In", "sports-accessories", "Baseball Glove", 1900, "Good", "Leather is supple and properly broken in. All laces intact, no tears."],
    ["Match Football Size 5", "football", "Football", 900, "Good", "Holds air well, used on grass only. All stitching intact, no scuffing on the panels."],
    ["Indoor Basketball", "sports-accessories", "Basketball", 1100, "Good", "Composite leather with good grip. Used indoors only, minimal wear."],
    ["Volleyball Match Ball", "sports-accessories", "Volleyball", 800, "Like new", "Soft touch, suitable for beach or indoor. Used twice."],
    ["Graphite Tennis Racket — Restrung", "badminton", "Tennis Racket", 3500, "Good", "Restrung last month, grip replaced. No frame damage or warping. Cover included."],
    ["Adjustable Dumbbell Set 20kg", "gym-equipment", null, 3500, "Good", "Pair of dumbbells with plates and spinlock collars. Cast iron, light surface rust on two plates which does not affect use."],
    ["Yoga Mat with Blocks and Strap", "yoga-fitness", null, 900, "Good", "6mm anti-slip mat plus two foam blocks and a strap. Mat has slight compression where the knees go. Cleaned before listing."],
    ["Cycling Helmet and Bottle Cage", "cycling", null, 1400, "Good", "Adjustable helmet, size M, no impacts. Aluminium bottle cage included. Selling with my old bike gone."],
  ],
  toys: [
    ["Monopoly Board Game — Complete", "board-games", null, 900, "Good", "All pieces, cards and money present — checked before listing. Box corners are worn but the board is fine."],
    ["Scrabble Original Edition", "board-games", null, 750, "Good", "All 100 tiles present. Board, racks and bag in good shape. Box lid has a small tear at one corner."],
    ["LEGO Classic Creative Bricks 500pc", "kids-toys", null, 2200, "Good", "Washed and sorted, complete set with the original tub and instruction booklet. No chewed or broken pieces."],
    ["Remote Control Rally Car", "kids-toys", null, 1800, "Good", "2.4GHz with rechargeable battery and charger. Runs well. One small scuff on the shell from a crash."],
    ["Xbox Wireless Controller — Carbon Black", "gaming-accessories", null, 3200, "Good", "No stick drift, all buttons responsive. Works on console and PC. Light shine on the grips."],
    ["Rubik's Cube Speed Set — 3 Cubes", "puzzles", null, 600, "Good", "2x2, 3x3 and 4x4. Lubricated and turning smoothly. Stickers all intact."],
    ["1000-Piece Jigsaw Puzzle", "puzzles", null, 400, "Good", "Landscape scene, completed once and boxed carefully. All pieces counted and present."],
  ],
  music: [
    ["Yamaha F310 Acoustic Guitar — Beginner", "guitars", null, 7500, "Good", "Great first guitar. New strings fitted and the action set low so it is easy to play. Small ding on the lower bout. Gig bag included."],
    ["Casio CT-S300 Keyboard — 61 Keys", "keyboards", null, 9500, "Like new", "Touch response, adapter and stand included. Bought during lockdown and barely played. All keys and functions work."],
    ["Tabla Set with Cushions — Recently Tuned", "tabla", null, 8500, "Good", "Sheesham dayan with a steel bayan. Re-skinned and tuned two months ago. Cushions and hammer included."],
    ["Electronic Drum Pad — 8 Pads", "drums", null, 5500, "Good", "Built-in speaker plus a headphone out for quiet practice. Sticks and adapter included. All pads trigger correctly."],
    ["Ukulele Concert Size — Mahogany", "other-instruments", null, 2800, "Good", "Tuned and very playable. Small scratch on the back. Padded gig bag included. Ideal for a beginner."],
    ["Dynamic Vocal Microphone with Cable", "microphones", null, 2400, "Good", "Handheld dynamic mic, clean sound with no crackle. XLR cable included. Used for a few gigs."],
  ],
  cameras: [
    ["TV Studio Camera Pedestal", "tripods", "TV Studio Camera Pedestal", 45000, "Good", "Professional pedestal with smooth pan and tilt. Column gas still holds pressure. Some paint wear on the base from studio use."],
    ["Camera Monopod with Head", "tripods", "Monopod", 2400, "Good", "Aluminium, extends to 1.6m. All twist locks grip firmly. Rubber foot in good shape."],
    ["Selfie Stick Monopod with Bluetooth", "camera-accessories", "Selfie Stick Monopod", 900, "Good", "Extendable with a detachable Bluetooth remote. Phone clamp fits up to 6.7 inches. Remote battery included."],
    ["Ring Selfie Lamp with Phone Mount", "camera-accessories", "Selfie Lamp with iPhone", 1600, "Like new", "Three brightness levels, clamps firmly to a desk. USB powered, cable included. Used a handful of times."],
    ["Pre-owned Canon DSLR with 18-55mm Lens", "dslr", null, 32000, "Good", "Entry-level DSLR, around 14,000 shutter actuations. Sensor clean, no fungus in the lens. Bag, two batteries and charger included."],
    ["Used 50mm f/1.8 Prime Lens", "lenses", null, 6500, "Good", "Sharp portrait lens. Front and rear caps included. Slight dust inside which does not affect images. No scratches on the glass."],
  ],
  pets: [
    ["Large Dog Crate with Washable Bed", "pet-beds", null, 4200, "Good", "Foldable metal crate that fits a Labrador comfortably. Tray included. Bed cover is machine washable and recently cleaned."],
    ["Aquarium 3ft with Filter and Stand", "aquariums", null, 5500, "Good", "Complete setup with filter, light and stand. Glass is clear with no leaks or chips. Selling as we are moving."],
    ["Pet Carrier — Airline Approved", "pet-accessories", null, 2200, "Good", "Hard-sided carrier for a cat or small dog. Door latch is secure, ventilation on all sides. Cleaned and disinfected."],
    ["Dog Collar, Leash and Harness Set", "pet-accessories", null, 900, "Good", "Adjustable nylon set, size M. Buckles all work. Light fraying on the leash handle."],
    ["Assorted Dog Chew Toys — Bundle", "pet-toys", null, 600, "Good", "Six rubber and rope toys, all washed. Some tooth marks, none torn or shedding pieces."],
    ["Aquarium Air Pump and Accessories", "pet-supplies", null, 1200, "Good", "Quiet air pump with tubing, air stones and a spare filter cartridge. All working."],
  ],
  accessories: [
    ["Rolex Datejust — Steel Jubilee Bracelet", "watches", "Rolex Datejust", 720000, "Good", "Keeps excellent time. Minor bracelet stretch consistent with age. Serviced two years ago, paperwork available."],
    ["Women's Gold Wrist Watch", "watches", "Watch Gold for Women", 4500, "Good", "Elegant everyday watch. Clasp is secure, glass unscratched. Light wear on the plating near the lugs."],
    ["Classic Sunglasses UV400 — Polarised", "sunglasses", "Classic Sun Glasses", 1600, "Like new", "Polarised lenses with no scratches. Hard case and cloth included. Worn a few times only."],
    ["Black Sunglasses — Lightweight Frame", "sunglasses", "Black Sun Glasses", 1200, "Good", "Lenses in perfect condition. Small scuff on one arm. Soft pouch included."],
    ["Tropical Statement Earrings", "jewellery", "Tropical Earring", 900, "Like new", "Lightweight and comfortable for all-day wear. Worn twice. Hooks are unbent."],
    ["Men's Leather Wallet — Gently Used", "wallets", null, 800, "Good", "Genuine leather bifold with card slots and a coin pocket. Slight softening at the fold, no tears. Stitching intact."],
    ["Travel Backpack 35L", "bags", null, 2400, "Good", "Cabin-friendly with a laptop sleeve and rain cover. All zips work. Light staining on the base from airport floors."],
  ],
};

const rand = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(list: T[]): T => list[rand(list.length)];

/** Tint per main category, so generated cards are distinguishable at a glance. */
const TINTS: Record<string, string> = {
  mobiles: "#3b82f6", electronics: "#06b6d4", computers: "#8b5cf6",
  cars: "#0ea5e9", bikes: "#f59e0b", furniture: "#f97316",
  "home-kitchen": "#64748b", "mens-fashion": "#6366f1",
  "womens-fashion": "#ec4899", "books-stationery": "#10b981",
  sports: "#14b8a6", toys: "#eab308", music: "#a855f7",
  cameras: "#d946ef", pets: "#22c55e", accessories: "#7c3aed",
};

const escapeXml = (value: string) =>
  value.replace(/[<>&"']/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

/**
 * Writes a card for one specific item and returns its public path.
 *
 * Named after the item, not the category: "Women's Saree" gets a card saying
 * Women's Saree. That is the difference between a placeholder and a wrong
 * photo — it never claims to depict something it is not, and it is never shared
 * with a different listing.
 */
function generateCard(itemTitle: string, categorySlug: string): string {
  const slug = itemTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const fileName = `${slug}.svg`;
  const tint = TINTS[categorySlug] ?? "#64748b";

  // Wrap onto at most three lines so long titles stay inside the card.
  const words = itemTitle.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > 22) { lines.push(line.trim()); line = word; }
    else line = `${line} ${word}`;
  }
  if (line.trim()) lines.push(line.trim());
  const shown = lines.slice(0, 3);

  const text = shown
    .map((l, i) => `<text x="400" y="${300 + i * 42 - (shown.length - 1) * 21}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="30" font-weight="700" fill="#18181b">${escapeXml(l)}</text>`)
    .join("\n  ");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600" role="img" aria-label="${escapeXml(itemTitle)}">
  <rect width="800" height="600" fill="#f4f4f5"/>
  <rect x="0" y="0" width="800" height="10" fill="${tint}"/>
  <circle cx="400" cy="170" r="54" fill="${tint}" opacity="0.15"/>
  <text x="400" y="188" text-anchor="middle" font-family="system-ui,sans-serif" font-size="44" font-weight="700" fill="${tint}">${escapeXml(itemTitle.charAt(0))}</text>
  ${text}
  <text x="400" y="470" text-anchor="middle" font-family="system-ui,sans-serif" font-size="19" fill="#71717a">Photo not supplied by seller</text>
</svg>`;

  fs.writeFileSync(path.join(GENERATED_DIR, fileName), svg, "utf-8");
  return `${config.imagesRoute}/generated/${fileName}`;
}

async function main(): Promise<void> {
  if (!fs.existsSync(MANIFEST)) {
    throw new Error(`No image manifest at ${MANIFEST}. Run: npm run images:fetch`);
  }
  fs.mkdirSync(GENERATED_DIR, { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf-8")) as ImageManifestEntry[];

  /* Photographs fetched per listing by "npm run images:items", keyed by the
     exact listing title. These cover the items DummyJSON has nothing for, so
     only a listing that neither source could photograph falls back to a card. */
  const itemPhotos = new Map<string, string>();
  if (fs.existsSync(ITEMS_MANIFEST)) {
    for (const entry of JSON.parse(fs.readFileSync(ITEMS_MANIFEST, "utf-8")) as
      { title: string; file: string }[]) {
      itemPhotos.set(entry.title, entry.file);
    }
  }

  /** Exact product title -> every photo of that one product, in order. */
  const photosByProduct = new Map<string, string[]>();
  for (const entry of manifest) {
    photosByProduct.set(entry.title, [
      ...(photosByProduct.get(entry.title) ?? []),
      entry.file,
    ]);
  }

  // A named product that is not in the manifest is a typo. Failing here is the
  // point: silently falling back is how a wrong photo reaches a listing.
  const missing = Object.values(ITEMS)
    .flat()
    .filter(([, , product]) => product !== null && !photosByProduct.has(product))
    .map(([title, , product]) => `${title} -> "${product}"`);
  if (missing.length > 0) {
    throw new Error(`Products not in manifest:\n  ${missing.join("\n  ")}`);
  }

  const client = new Client({ connectionString: config.databaseUrl });
  await client.connect();

  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM listings");
    await client.query("DELETE FROM listing_categories");

    // Mains first: a subcategory's parent_slug references one.
    for (const [index, category] of CATEGORIES.entries()) {
      await client.query(
        `INSERT INTO listing_categories (slug, label, audience, "order", parent_slug)
         VALUES ($1, $2, 'Unisex', $3, NULL)`,
        [category.slug, category.label, index],
      );
    }
    let subCount = 0;
    for (const category of CATEGORIES) {
      for (const [order, [slug, label]] of category.subs.entries()) {
        await client.query(
          `INSERT INTO listing_categories (slug, label, audience, "order", parent_slug)
           VALUES ($1, $2, 'Unisex', $3, $4)`,
          [`${category.slug}--${slug}`, label, order, category.slug],
        );
        subCount++;
      }
    }

    const { rows: sellers } = await client.query<{ id: number }>(
      `SELECT id FROM users ORDER BY id LIMIT 400`,
    );
    if (sellers.length === 0) throw new Error("No users to own listings.");

    let total = 0;
    let generated = 0;

    for (const category of CATEGORIES) {
      for (const [title, sub, product, price, condition, description] of
        ITEMS[category.slug] ?? []) {
        const [city, area] = pick(CITIES);
        const daysAgo = 1 + rand(40);
        const postedAt = new Date(Date.now() - daysAgo * 86400000);

        const roll = rand(100);
        const status = roll < 7 ? "sold" : roll < 12 ? "expired" : "active";

        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO listings
             (seller_id, title, description, category_slug, subcategory_slug, audience,
              condition, price, city, location, status, view_count, posted_at,
              expires_at, sold_at)
           VALUES ($1,$2,$3,$4,$5,'Unisex',$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING id::text`,
          [
            pick(sellers).id, title, description, category.slug,
            `${category.slug}--${sub}`, condition, price, city, area, status,
            rand(900), postedAt, new Date(postedAt.getTime() + 45 * 86400000),
            status === "sold" ? new Date() : null,
          ],
        );

        let photos: string[];
        if (product !== null) {
          photos = photosByProduct.get(product)!.slice(0, 6);
        } else if (itemPhotos.has(title)) {
          photos = [itemPhotos.get(title)!];
        } else {
          photos = [generateCard(title, category.slug)];
          generated++;
        }

        for (const [position, file] of photos.entries()) {
          await client.query(
            `INSERT INTO listing_photos (listing_id, path, is_primary, position)
             VALUES ($1, $2, $3, $4)`,
            [rows[0].id, file, position === 0, position],
          );
        }
        total++;
      }
    }

    await client.query("COMMIT");
    console.log(
      `[seed] ${CATEGORIES.length} categories, ${subCount} subcategories, ${total} listings ` +
        `(${total - generated} with product photos, ${generated} with per-item cards)`,
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

/* Only seed when run directly. The image fetcher imports ITEMS from here, and
   importing a module must not drop the listings table as a side effect. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  });
}
